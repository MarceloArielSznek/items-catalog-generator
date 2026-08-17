import logger from '../utils/logger.js';

/**
 * Drives a full operational simulation against a live Menaia org:
 *
 *   lead → visit → estimate → Sold → job → shifts → worked hours → close
 *          ↘ comments, expenses, reviews, tasks, time off, invoices
 *
 * Everything goes through the same REST endpoints the web app uses, so the
 * real business logic runs: selling an estimate cascades into a work order and
 * a job, closing a job triggers the bonus recalculation, and so on.
 *
 * AUTH NOTE — this service does NOT use the app's service-account API key.
 * `SCOPE_TO_SUBJECT_ACTIONS` defines no write scope for Proposal, JobEstimate
 * or Job, so an API key physically cannot build this funnel. A *user* principal
 * carries no scopes claim at all, so the scope gate no-ops and the caller gets
 * their full CASL role abilities. Hence the email/password grant below.
 */

const V1 = '/v1';

// ── fixtures ────────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Marcus', 'Elena', 'Priya', 'Daniel', 'Rosa', 'Tomas', 'Aisha', 'Grant',
  'Nadia', 'Owen', 'Camila', 'Hector', 'Ingrid', 'Julian', 'Mei', 'Reuben',
];
const LAST_NAMES = [
  'Whitfield', 'Alvarez', 'Nakamura', 'Osei', 'Lindqvist', 'Barros', 'Haddad',
  'Petrov', 'Okonkwo', 'Delacroix', 'Farrell', 'Ibarra', 'Stroud', 'Vasquez',
];
const STREETS = [
  'Cedar Ridge Rd', 'Harbor Ln', 'Juniper Way', 'Maple Hollow Dr',
  'Sandpiper Ct', 'Ironwood Ave', 'Larkspur St', 'Quarry Bend',
];
const PROJECT_KINDS = [
  'Attic Insulation Replacement', 'Radiant Barrier Install', 'Crawlspace Cleanup',
  'Air Duct Replacement', 'Rodent Proofing', 'Attic Sanitation',
];
const PROJECT_COMMENTS = [
  'Walked the attic with the homeowner — access is through the hallway closet, tight but workable.',
  'Confirmed R-38 blown-in for the main area. Crew should bring the extra hose length.',
  'Homeowner asked about scheduling around their work-from-home hours. Mornings are fine.',
  'Existing insulation is compacted and has rodent activity. Sanitation recommended first.',
  'Sent the proposal over. Client said they would review with their spouse this week.',
  'Follow-up call — client is comparing quotes, still interested.',
  'Parking is tight on this street; van should arrive before 8am.',
  'Client confirmed the deposit went through. Ready to schedule.',
  'Crew finished the tear-out today, staging the new material tomorrow morning.',
  'Punch list complete. Took before/after photos for the file.',
  'Homeowner very happy with the crew — mentioned they would refer a neighbour.',
];
const EXPENSE_NOTES = [
  'Blown-in insulation material', 'Dumpster rental', 'Crew per-diem',
  'Rodent proofing mesh + sealant', 'Equipment rental', 'Disposal fees',
];
const TASK_TITLES = [
  'Quality control visit', 'Client follow-up call', 'Material pickup',
  'Permit drop-off', 'Warranty check-in',
];
const SHIFT_TITLES = [
  'Tear-out & prep', 'Insulation install', 'Sanitation', 'Final walkthrough',
];

const UNSOLD_ESTIMATE_STATUSES = ['In Progress', 'Released', 'Lost', 'Secondary Estimate'];
const CLOSED_JOB_STATUS = 'Closed Job';

/** All outbound notifications off — a simulation must never email anyone. */
const SILENT = { emailAssignedTeam: false, emailSalesPerson: false, emailClient: false };

/**
 * Conversion rates the whole funnel is derived from. The operator supplies a
 * lead count and nothing else; these turn it into visits, sales and invoices.
 * Half of leads book a visit, half of those sell, and most sold work gets
 * invoiced — which is the 20 → 10 → 5 shape a real branch runs at.
 *
 * Variety comes from *outcomes*, not from these counts: which jobs close, which
 * estimates are lost, and how far back each sale is dated are all decided per
 * record further down.
 */
const FUNNEL_RATES = { visitsPerLead: 0.5, soldPerVisit: 0.5, invoicedPerSale: 0.6 };

/** Turns a single lead count into the full funnel. Exported for the UI preview. */
export function deriveFunnel(leads) {
  const count = Math.max(0, Math.round(Number(leads) || 0));
  const visits = Math.round(count * FUNNEL_RATES.visitsPerLead);
  const sold = Math.round(visits * FUNNEL_RATES.soldPerVisit);
  const invoices = Math.round(sold * FUNNEL_RATES.invoicedPerSale);
  return { leads: count, visits, sold, invoices };
}

/** Shifts an offset off Saturday/Sunday so work lands on weekdays. */
function toWeekday(dayOffset) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const dow = d.getDay();
  if (dow === 6) return dayOffset + 2; // Saturday → Monday
  if (dow === 0) return dayOffset + 1; // Sunday → Monday
  return dayOffset;
}

/**
 * Places visit number `index` on a calendar without bunching.
 *
 * The naive version (`index % 5` for the day, a fixed 9am start) collapsed:
 * with N salespeople and the owner picked by `index % N`, person and day
 * correlate, so one person ends up with every one of their visits on the same
 * morning. Dividing instead of modding gives each person one visit per day,
 * and staggering the hour by person stops them all starting at nine.
 */
function visitSlot(index, salesCount, startDayOffset = -21) {
  const person = index % salesCount;
  const round = Math.floor(index / salesCount);
  const dayOffset = toWeekday(startDayOffset + round);
  // 8am–4pm, offset per person so two people rarely share a start time.
  const hour = 8 + ((person * 3 + round) % 9);
  const minute = (person % 4) * 15;
  return { dayOffset, hour, minute };
}

/**
 * `count` consecutive *working* day offsets from `start`. A crew booked for
 * three days starting Friday works Fri/Mon/Tue, not Fri/Sat/Sun — which is
 * what a naive `start + i` produced.
 */
function workdayOffsets(start, count) {
  const out = [];
  let offset = start;
  while (out.length < count) {
    const adjusted = toWeekday(offset);
    out.push(adjusted);
    offset = adjusted + 1;
  }
  return out;
}

/**
 * A random working slot on a weekday. Tasks were all being written at exactly
 * 10:00, which reads as machine-generated the moment you open a calendar.
 */
function randomWorkSlot(dayOffset) {
  return {
    dayOffset: toWeekday(dayOffset),
    hour: randInt(8, 16),
    minute: pick([0, 15, 30, 45]),
  };
}

/** ISO timestamp at a day offset with explicit hour/minute. */
function isoAtTime(dayOffset, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '.');

/** ISO timestamp `dayOffset` days from today; negative is past, positive future. */
function isoAtOffset(dayOffset, hour) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function daysUntilEndOf(monthIndex) {
  const end = new Date(new Date().getFullYear(), monthIndex + 1, 0, 23, 59, 59);
  return Math.max(0, Math.round((end.getTime() - Date.now()) / 86400000));
}

/**
 * Contacts always use the reserved `example.com` domain (RFC 2606) so that even
 * if a notification slips past the suppression flags it cannot reach a real
 * inbox.
 */
function makeContact(runTag, index) {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  return {
    firstName,
    lastName,
    email: `${slug(firstName)}.${slug(lastName)}.${runTag}${index}@example.com`,
    phone: `555${randInt(1000000, 9999999)}`,
    address: `${randInt(100, 8999)} ${pick(STREETS)}`,
    projectName: `${pick(PROJECT_KINDS)} — ${lastName}`,
  };
}

function makePricing() {
  const retailCost = randInt(2500, 16000);
  const discount = Math.random() < 0.3 ? Math.round(retailCost * 0.08) : 0;
  const finalPrice = retailCost - discount;
  const taxableFinalPrice = Math.round(finalPrice * 0.6);
  return {
    retailCost,
    laborHours: randInt(8, 48),
    finalPrice,
    taxableFinalPrice,
    taxAmount: Math.round(taxableFinalPrice * 0.0975),
    trueCost: Math.round(retailCost * 0.55),
  };
}

/**
 * Job status follows the age of the sale: work sold months ago has finished,
 * work sold last week has not. This is also what produces closed jobs, and
 * only closed jobs generate bonus payouts.
 */
function pickJobStatusFor(soldDaysAgo) {
  if (soldDaysAgo > 55) return pick([CLOSED_JOB_STATUS, CLOSED_JOB_STATUS, 'Pending Payment', 'Cancelled']);
  if (soldDaysAgo > 30) return pick(['Production Complete', 'Pending Payment', 'In Production', CLOSED_JOB_STATUS]);
  if (soldDaysAgo > 14) return pick(['In Production', 'Pre-Production', 'Requires Scheduling']);
  return pick(['Requires Crew Lead', 'Plans In Progress', 'Requires Scheduling']);
}

// ── HTTP ────────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} → ${status} ${String(body).slice(0, 300)}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * The API throttles at 100 requests per 60s per principal
 * (`ThrottlerModule.forRoot` in the api's app.module). Firing flat out gets a
 * run killed by a 429 partway through, so every mutation is spaced to stay
 * just under that ceiling — and a 429 that slips through is retried rather
 * than aborting work already in flight.
 */
const THROTTLE_INTERVAL_MS = 620; // ~96 requests/minute
const MAX_429_RETRIES = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createClient({ apiBase, accessToken, organizationId, commit, onStep }) {
  let nextSlot = 0;

  /** Blocks until this caller's turn in the rate budget. */
  async function pace() {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + THROTTLE_INTERVAL_MS;
    if (wait > 0) await sleep(wait);
  }

  const headers = () => ({
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    ...(organizationId ? { 'X-Organization-Id': String(organizationId) } : {}),
  });

  const mutations = { count: 0 };

  async function get(path) {
    // Reads count against the same budget as writes.
    await pace();
    const res = await fetch(`${apiBase}${V1}${path}`, { headers: headers() });
    if (!res.ok) throw new ApiError('GET', path, res.status, await res.text());
    return res.json();
  }

  async function mutate(method, path, body, label) {
    mutations.count += 1;
    onStep({ kind: commit ? 'send' : 'plan', text: `${method} ${path} — ${label}` });
    if (!commit) return null;

    for (let attempt = 0; ; attempt += 1) {
      await pace();
      const res = await fetch(`${apiBase}${V1}${path}`, {
        method,
        headers: headers(),
        body: JSON.stringify(body),
      });

      if (res.status === 429 && attempt < MAX_429_RETRIES) {
        // Honour Retry-After when the server sends one; otherwise back off
        // enough to let the 60s window roll forward.
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 5000 * (attempt + 1);
        onStep({ kind: 'note', text: `Rate limited — waiting ${Math.round(waitMs / 1000)}s` });
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) throw new ApiError(method, path, res.status, await res.text());
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  }

  /** Non-fatal wrapper for decorative writes — losing one must not abort a run. */
  async function optional(label, fn) {
    try {
      return await fn();
    } catch (err) {
      onStep({ kind: 'skip', text: `skipped ${label}: ${err.message.slice(0, 160)}` });
      return null;
    }
  }

  /** Returns null for reference data the run can live without. */
  async function tryGet(path) {
    try {
      return await get(path);
    } catch (err) {
      if ([400, 403, 404].includes(err.status)) return null;
      throw err;
    }
  }

  return { get, mutate, optional, tryGet, mutations };
}

/** Paginated routes return `{data, meta}`; some return a bare array. */
const unwrap = (payload) => (Array.isArray(payload) ? payload : (payload?.data ?? []));

// ── auth + lookups ──────────────────────────────────────────────────────────

export async function authenticate({ supabaseUrl, supabaseAnonKey, email, password }) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    throw new Error(`Sign-in failed for ${email}: ${body?.error_description || body?.msg || res.status}`);
  }
  return body.access_token;
}

/**
 * The caller's own org memberships. `/organization/memberships` is the one
 * pre-org-context read: it authenticates on the JWT alone and is scoped
 * server-side to the token's orgs — the same call the web login picker makes.
 */
export async function fetchOrganizations(config) {
  const accessToken = await authenticate(config);
  const res = await fetch(`${config.apiBase}${V1}/organization/memberships`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Could not list organizations (${res.status})`);
  return { organizations: await res.json(), email: config.email };
}

/** Branch memberships for one org, with display names, straight off `/me`. */
export async function fetchBranches(config, organizationId) {
  const accessToken = await authenticate(config);
  const res = await fetch(`${config.apiBase}${V1}/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-Organization-Id': String(organizationId),
    },
  });
  if (!res.ok) throw new Error(`Could not read /me (${res.status})`);
  const me = await res.json();
  return {
    organizationName: me?.organization?.name ?? null,
    branches: (me?.branches ?? []).map((b) => ({ id: b.id, name: b.name })),
  };
}

/**
 * Reference data resolved live. None of it can be hardcoded: lead statuses and
 * sources are org-configurable rows, so their ids differ per environment.
 *
 * Branches and the assignee come from `/me`, NOT `/branches` + `/users` — those
 * list endpoints need elevated abilities (a Sales Member gets 403) while `/me`
 * is readable by any authenticated principal.
 */
async function loadReference(api, branchIdOverride, onStep) {
  const me = await api.get('/me');
  const branchId = branchIdOverride ?? me.branches?.[0]?.id;
  if (!branchId) throw new Error('The user has no branch membership in this organization.');

  const statuses = await api.tryGet('/lead-statuses');
  if (!statuses) throw new Error('This user cannot read lead statuses (403).');
  const leadStatuses = unwrap(statuses).map((s) => ({ id: s.id, name: s.name }));
  if (!leadStatuses.length) throw new Error('Organization has no lead statuses configured.');

  const sources = await api.tryGet('/lead-sources');
  const leadSourceIds = sources ? unwrap(sources).map((s) => s.id) : [];

  // The branch filter is not optional: publishing a lead activity rejects an
  // assignee who is not a member of the job's branch.
  const usersPayload = await api.tryGet(`/users?branch=${branchId}&pageSize=200`);
  let users = usersPayload ? unwrap(usersPayload) : [];
  if (!users.length && me.user?.id) {
    users = [{ id: me.user.id, username: me.user.email || 'You', roles: me.principal?.roles || [] }];
  }
  if (!users.length) throw new Error('No users available to assign work to.');
  const people = splitPeople(users);
  const assigneeIds = users.map((u) => u.id);

  const [expenseTypes, taskTypes] = await Promise.all([
    api.tryGet('/expense-types'),
    api.tryGet('/task-types'),
  ]);

  // Payment terms hang off the branch *configuration*, not the branch.
  let paymentTermId = null;
  const branch = await api.tryGet(`/branches/${branchId}`);
  if (branch?.configurationId) {
    const terms = await api.tryGet(`/payment-terms?branchConfigurationId=${branch.configurationId}`);
    paymentTermId = terms ? (unwrap(terms)[0]?.id ?? null) : null;
  }
  if (!paymentTermId) onStep({ kind: 'note', text: 'No payment term resolved — invoices will be skipped.' });

  // The bonus pool is `hoursSaved × baseHourlyRate × bonusPoolPercentage`, and a
  // bonus-affecting expense is subtracted from it whole. Reading the branch's
  // real constants is the only way to size those expenses sanely — at Attic's
  // 32 × 0.1, saving twenty hours creates a $64 pool, so a $900 expense buries
  // it far past anything the crew could have earned back.
  const base = branch?.configuration?.baseConstants;
  const bonusConstants = base
    ? { baseHourlyRate: base.baseHourlyRate, bonusPoolPercentage: base.bonusPoolPercentage }
    : null;
  if (!bonusConstants) {
    onStep({ kind: 'note', text: 'No bonus constants on the branch — bonus expenses will be skipped.' });
  }

  return {
    branchId,
    people,
    assigneeIds,
    leadStatuses,
    leadSourceIds,
    expenseTypeIds: expenseTypes ? unwrap(expenseTypes).map((t) => t.id) : [],
    taskTypeIds: taskTypes ? unwrap(taskTypes).map((t) => t.id) : [],
    paymentTermId,
    bonusConstants,
  };
}

// ── who does what ───────────────────────────────────────────────────────────

const SALES_ROLES = ['Sales Member', 'Sales Admin'];
const CREW_ROLES = ['Crew Leader', 'Crew Member'];

/** Crew days per job, by job index — fixed so the preview matches the run. */
const crewDaysFor = (jobIndex) => 1 + (jobIndex % 3);
/** People on site per day. */
const CREW_PER_DAY = 3;

/**
 * Splits the branch's people into the two pools the simulation draws from.
 * Falls back to everyone available when a branch has no one in a given role,
 * so a thinly-staffed org still runs rather than failing.
 */
export function splitPeople(users) {
  const has = (u, roles) => u.roles?.some((r) => roles.includes(r));
  const sales = users.filter((u) => has(u, SALES_ROLES));
  const crew = users.filter((u) => has(u, CREW_ROLES));
  return {
    sales: sales.length ? sales : users,
    crew: crew.length ? crew : users,
    all: users,
  };
}

/**
 * Assigns the funnel to named people, deterministically — round-robin, no
 * randomness — so the preview shown before a run is exactly what the run does.
 *
 * Sales own leads; a lead's visit and sale stay with whoever owns the lead, the
 * way a real branch works. Crew rotate through job days.
 */
export function planAssignments(people, funnel) {
  const salesPlan = people.sales.map((u) => ({
    id: u.id,
    name: u.username,
    role: (u.roles || []).find((r) => SALES_ROLES.includes(r)) || (u.roles || [])[0] || '—',
    leads: 0,
    visits: 0,
    sales: 0,
  }));

  for (let i = 0; i < funnel.leads; i += 1) {
    const owner = salesPlan[i % salesPlan.length];
    if (!owner) break;
    owner.leads += 1;
    if (i < funnel.visits) owner.visits += 1;
    if (i < funnel.sold) owner.sales += 1;
  }

  const crewPlan = people.crew.map((u) => ({
    id: u.id,
    name: u.username,
    role: (u.roles || []).find((r) => CREW_ROLES.includes(r)) || (u.roles || [])[0] || '—',
    shiftDays: 0,
    leadsCrew: 0,
  }));

  let slot = 0;
  for (let job = 0; job < funnel.sold; job += 1) {
    for (let day = 0; day < crewDaysFor(job); day += 1) {
      const size = Math.min(CREW_PER_DAY, crewPlan.length);
      for (let s = 0; s < size; s += 1) {
        const member = crewPlan[slot % crewPlan.length];
        if (!member) break;
        member.shiftDays += 1;
        if (s === 0) member.leadsCrew += 1; // first slot is the crew lead
        slot += 1;
      }
    }
  }

  return { sales: salesPlan, crew: crewPlan };
}

/** Crew for one job-day, matching the rotation `planAssignments` counted. */
function crewForSlot(crew, startSlot) {
  const size = Math.min(CREW_PER_DAY, crew.length);
  return Array.from({ length: size }, (_, s) => crew[(startSlot + s) % crew.length]);
}

/** Statuses that imply a visit happened — excluded when scattering dead leads. */
const CONVERTED_HINTS = ['sold', 'won', 'scheduled', 'estimat'];
function scatterableStatuses(ref) {
  const out = ref.leadStatuses.filter(
    (s) => !CONVERTED_HINTS.some((h) => s.name.toLowerCase().includes(h)),
  );
  return out.length ? out : ref.leadStatuses;
}

/**
 * Who will do what, without writing anything. Resolves the branch's real people
 * and runs the same `planAssignments` the simulation uses, so what this returns
 * is what will actually happen — not an estimate of it.
 */
export async function previewSimulation(config) {
  const { apiBase, organizationId, branchId = null, leads } = config;
  const accessToken = await authenticate(config);
  const api = createClient({
    apiBase, accessToken, organizationId, commit: false, onStep: () => {},
  });

  const me = await api.get('/me');
  const resolvedBranch = branchId ?? me.branches?.[0]?.id;
  if (!resolvedBranch) throw new Error('The user has no branch membership in this organization.');

  const payload = await api.tryGet(`/users?branch=${resolvedBranch}&pageSize=200`);
  const users = payload ? unwrap(payload) : [];
  if (!users.length) throw new Error('No users found in this branch.');

  const funnel = deriveFunnel(leads ?? 20);
  const people = splitPeople(users);
  const plan = planAssignments(people, funnel);

  return {
    funnel,
    branchId: resolvedBranch,
    peopleCount: users.length,
    // Surfaced so the UI can warn when a branch has nobody in a role and the
    // pools silently fell back to "everyone".
    fellBackToEveryone: {
      sales: !users.some((u) => u.roles?.some((r) => SALES_ROLES.includes(r))),
      crew: !users.some((u) => u.roles?.some((r) => CREW_ROLES.includes(r))),
    },
    ...plan,
  };
}

// ── the simulation ──────────────────────────────────────────────────────────

export async function runSimulation(config, onStep) {
  const { apiBase, organizationId, branchId = null, commit = false, leads: leadCount } = config;
  const t = deriveFunnel(leadCount ?? 20);
  if (t.leads === 0) throw new Error('Lead count must be at least 1.');
  onStep({
    kind: 'note',
    text: `Funnel: ${t.leads} leads → ${t.visits} visits → ${t.sold} sold → ${t.invoices} invoiced`,
  });

  const accessToken = await authenticate(config);
  onStep({ kind: 'note', text: `Authenticated as ${config.email}` });

  // Guard: refuse unless the active org is the one the operator selected. A
  // user token can span organizations, so this is what stops a misconfigured
  // run from writing into a different customer's data.
  const probe = await fetch(`${apiBase}${V1}/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-Organization-Id': String(organizationId) },
  });
  if (!probe.ok) throw new Error(`Could not verify organization (${probe.status})`);
  const me = await probe.json();
  if (me?.organization?.id !== Number(organizationId)) {
    throw new Error(
      `Refusing to run: active organization is ${me?.organization?.id} but ${organizationId} was selected.`,
    );
  }
  onStep({ kind: 'note', text: `Organization check passed — ${me.organization.name} (${me.organization.id})` });

  const api = createClient({ apiBase, accessToken, organizationId, commit, onStep });
  const ref = await loadReference(api, branchId, onStep);
  onStep({
    kind: 'note',
    text: `Branch ${ref.branchId} · ${ref.assigneeIds.length} users · ${ref.leadStatuses.length} lead statuses`,
  });

  const horizon = Math.max(14, daysUntilEndOf(9)); // through end of October
  const runTag = `d${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const summary = {
    leads: 0, visits: 0, estimates: 0, sold: 0, backdated: 0, jobs: 0,
    shiftDays: 0, workedShifts: 0, comments: 0, expenses: 0, bonusExpenses: 0,
    reviews: 0, tasks: 0, timeOff: 0, invoices: 0, scattered: 0,
  };

  // 1 ── leads
  onStep({ kind: 'stage', text: `Stage 1/7 — creating ${t.leads} leads` });
  const leads = [];
  for (let i = 0; i < t.leads; i += 1) {
    const c = makeContact(runTag, i);
    const created = await api.mutate('POST', '/leads', {
      contacts: [{ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, isPrimary: true }],
      address: c.address,
      branchId: ref.branchId,
      ...(ref.leadSourceIds.length ? { leadSourceId: pick(ref.leadSourceIds) } : {}),
      notes: `Simulated lead ${runTag}.`,
    }, `lead ${c.firstName} ${c.lastName}`);
    summary.leads += 1;
    if (created) leads.push({ id: created.id, contact: c });
  }
  if (!leads.length) {
    onStep({ kind: 'note', text: 'Dry run — later stages need server-assigned ids, stopping after stage 1.' });
    return { summary, mutations: api.mutations.count };
  }

  // 2 ── visits. Publishing runs find-or-create for client/property/project.
  onStep({ kind: 'stage', text: `Stage 2/7 — publishing ${Math.min(t.visits, leads.length)} visits` });
  const projects = [];
  for (const [index, lead] of leads.slice(0, t.visits).entries()) {
    const slot = visitSlot(index, ref.people.sales.length);
    const res = await api.mutate('PUT', '/lead-activities/schedule', {
      branchId: ref.branchId,
      leadId: lead.id,
      // The lead's owner runs its visit — the same round-robin the preview showed.
      assigneeId: ref.people.sales[index % ref.people.sales.length].id,
      startTime: isoAtTime(slot.dayOffset, slot.hour, slot.minute),
      endTime: isoAtTime(slot.dayOffset, slot.hour + 1, slot.minute),
      address: lead.contact.address,
      projectName: lead.contact.projectName,
      status: 'published',
      clientConfirmed: Math.random() < 0.7,
      hotLead: Math.random() < 0.3,
      flexibleClient: Math.random() < 0.5,
      notes: 'Simulated site visit.',
      notificationSettings: SILENT,
    }, `visit for lead ${lead.id}`);
    summary.visits += 1;
    if (res?.publishedProject) projects.push({ ...res.publishedProject, contact: lead.contact });
  }

  // 3 ── estimates
  onStep({ kind: 'stage', text: `Stage 3/7 — creating ${projects.length} estimates` });
  const estimates = [];
  for (const p of projects) {
    const pricing = makePricing();
    const created = await api.mutate('POST', '/job-estimates', {
      name: p.contact.projectName,
      branchId: ref.branchId,
      existingClientId: p.clientId,
      existingProjectId: p.projectId,
      paymentMethod: 'cash',
      // `services` is required. An empty array is the documented From-Scratch
      // flow; building real services would mean replicating the org catalog.
      isFromScratch: true,
      services: [],
      ...pricing,
    }, `estimate for project ${p.projectId} ($${pricing.finalPrice})`);
    summary.estimates += 1;
    if (created) estimates.push({ id: created.id, projectId: p.projectId, laborHours: pricing.laborHours });
  }

  // 4 ── sell a slice; the cascade creates the work order + job
  const sold = estimates.slice(0, t.sold);
  const unsold = estimates.slice(t.sold);
  onStep({ kind: 'stage', text: `Stage 4/7 — selling ${sold.length}, scattering ${unsold.length}` });
  for (const e of sold) {
    await api.mutate('PATCH', `/job-estimates/${e.id}/status`, { status: 'Sold' }, `sell estimate ${e.id}`);
    summary.sold += 1;
    // `createdAt` is server-stamped and cannot be overridden, but the sold date
    // can — and it is what the sales leaderboard aggregates over.
    e.soldDaysAgo = randInt(2, 100);
    await api.optional('backdate', () => api.mutate(
      'PATCH', `/job-estimates/${e.id}/effective-sold-date`,
      { effectiveSoldDate: isoAtOffset(-e.soldDaysAgo, 14) },
      `backdate estimate ${e.id} to ${e.soldDaysAgo}d ago`,
    ));
    summary.backdated += 1;
  }
  for (const e of unsold) {
    await api.mutate('PATCH', `/job-estimates/${e.id}/status`,
      { status: pick(UNSOLD_ESTIMATE_STATUSES) }, `estimate ${e.id} → non-sold`);
  }

  // 5 ── jobs: shifts, worked hours, close, then the surrounding detail
  onStep({ kind: 'stage', text: 'Stage 5/7 — shifts, worked hours, jobs, comments, invoices' });
  let crewSlot = 0;
  for (const [jobIndex, e] of sold.entries()) {
    // `/jobs/by-estimate/:id` returns a single nullable object, not a list.
    const job = await api.optional('job lookup', () => api.get(`/jobs/by-estimate/${e.id}`));
    if (!job?.id) continue;

    const soldDaysAgo = e.soldDaysAgo ?? 30;
    // Day count follows the job index, not chance, so the crew rotation the
    // preview computed lines up exactly with what gets written.
    const dayCount = crewDaysFor(jobIndex);
    const startOffset = soldDaysAgo > 21 ? -(soldDaysAgo - randInt(3, 14)) : randInt(1, Math.max(2, horizon));

    const scheduled = await api.optional('shifts', async () => {
      // Weekday-only run of days, and a start hour that varies by job so the
      // schedule isn't a wall of identical 8-to-4 blocks. Both derived from the
      // job index rather than random, so the preview stays accurate.
      const offsets = workdayOffsets(startOffset, dayCount);
      const startHour = 7 + (jobIndex % 3); // 7, 8 or 9
      const endHour = startHour + 8;

      const days = offsets.map((dayOffset, i) => {
        const crew = crewForSlot(ref.people.crew, crewSlot).map((u) => u.id);
        crewSlot += crew.length;
        return {
          dayIndex: i,
          startISO: isoAtTime(dayOffset, startHour),
          endISO: isoAtTime(dayOffset, endHour),
          userIds: crew,
          crewLeadId: crew[0] ?? null,
          status: 'published',
          shiftTitle: SHIFT_TITLES[i % SHIFT_TITLES.length],
          breakName: 'Lunch',
          breakDurationMinutes: 30,
        };
      });
      const res = await api.mutate('POST', '/job-schedule-shifts/bulk',
        { jobId: job.id, days, notificationSettings: SILENT },
        `${dayCount} shift day(s) for job ${job.id}`);
      const out = [];
      res?.savedDayIndexes?.forEach((dayIndex, pos) => {
        const id = res.ids?.[pos];
        const day = days[dayIndex];
        if (id && day) {
          out.push({
            id,
            userIds: day.userIds,
            dayOffset: offsets[dayIndex],
            startHour,
          });
        }
      });
      return out;
    });
    summary.shiftDays += scheduled?.length ?? 0;

    // Worked hours must exist BEFORE the job closes: the bonus recalculation
    // reads `job_shifts` (a different table from `job_schedule_shifts`) and
    // refuses to run unless one carries a userId.
    let hoursSaved = null;
    if (scheduled?.length) {
      await api.optional('worked hours', async () => {
        const past = scheduled.filter((d) => d.dayOffset <= 0);
        const personDays = past.reduce((n, d) => n + d.userIds.length, 0);
        if (!personDays) return 0;
        // Worked hours are derived from the estimate's budget: most crews come
        // in under, a minority run over. Generating them independently is what
        // made every bonus land negative.
        const factor = Math.random() < 0.25 ? 1.02 + Math.random() * 0.18 : 0.55 + Math.random() * 0.35;
        const targetTotal = e.laborHours * factor;

        // Do NOT clamp the per-person figure up to a minimum: that was the bug
        // behind every negative bonus. A small budget spread over nine
        // person-days gives 0.6h each, which a `Math.max(2, …)` inflated to 2h
        // — quietly tripling the hours worked against a fixed budget.
        //
        // Instead, keep the total honest and use fewer people: a job budgeted
        // at eight hours gets one crew member for a day, not three for three.
        const slots = Math.max(1, Math.min(personDays, Math.round(targetTotal / 7)));
        const hoursEach = Math.min(10, Math.max(2, targetTotal / slots));

        let used = 0;
        for (const day of past) {
          for (const userId of day.userIds) {
            if (used >= slots) break;
            used += 1;
            // Nobody clocks in on the exact minute the shift starts; a few
            // minutes either side is what a real timesheet looks like.
            const start = new Date(isoAtTime(day.dayOffset, day.startHour ?? 8, randInt(-8, 12)));
            const end = new Date(start.getTime() + (hoursEach * 60 + 30) * 60000);
            const bStart = new Date(start.getTime() + 4 * 3600000);
            await api.mutate('POST', '/time-tracking/enter', {
              userId,
              scheduleShiftId: day.id,
              clockInTime: start.toISOString(),
              clockOutTime: end.toISOString(),
              breaks: [{ breakStart: bStart.toISOString(), breakEnd: new Date(bStart.getTime() + 1800000).toISOString() }],
            }, `worked hours: user ${userId} (${hoursEach.toFixed(1)}h)`);
            summary.workedShifts += 1;
          }
          if (used >= slots) break;
        }
        // What the bonus maths will see: budget minus the hours actually logged.
        hoursSaved = e.laborHours - hoursEach * used;
        return summary.workedShifts;
      });
    }

    // Publishing shifts moves a job out of Requires Scheduling, so the explicit
    // status must be set after them.
    const jobStatus = pickJobStatusFor(soldDaysAgo);
    await api.mutate('PATCH', `/jobs/${job.id}/status`, { status: jobStatus }, `job ${job.id} → ${jobStatus}`);
    summary.jobs += 1;

    await api.optional('comments', async () => {
      for (let i = 0; i < randInt(2, 4); i += 1) {
        await api.mutate('POST', '/comments', {
          entityType: 'project', entityId: e.projectId, bodyMarkdown: pick(PROJECT_COMMENTS), mediaIds: [],
        }, `comment on project ${e.projectId}`);
        summary.comments += 1;
      }
    });

    // A bonus-affecting expense is subtracted whole from the pool, so it is
    // only worth marking one when there IS a pool — i.e. the crew finished
    // under budget — and even then it has to be small relative to it. Ordinary
    // job costs stay full-size; they just don't touch the bonus.
    const pool = hoursSaved > 0 && ref.bonusConstants
      ? hoursSaved * ref.bonusConstants.baseHourlyRate * ref.bonusConstants.bonusPoolPercentage
      : 0;

    await api.optional('expenses', async () => {
      for (let i = 0; i < randInt(1, 3); i += 1) {
        // The target resolves through findMostRecentClosedJobIdForProject, so
        // the job must literally be closed.
        const affectsBonus =
          jobStatus === CLOSED_JOB_STATUS && pool > 0 && i === 0 && Math.random() < 0.5;

        let amount = randInt(120, 2500);
        let bonusPercentage = null;
        if (affectsBonus) {
          // Take a 5–30% bite out of the pool, and derive the expense amount
          // from that rather than the other way round.
          bonusPercentage = pick([25, 50]);
          const deduction = pool * (0.05 + Math.random() * 0.25);
          amount = Math.max(20, Math.round(deduction / (bonusPercentage / 100)));
        }

        await api.mutate('POST', '/project-expenses', {
          branchId: ref.branchId,
          projectId: e.projectId,
          expenseTypeId: pick(ref.expenseTypeIds),
          amount,
          status: pick(['budgeted', 'confirmed', 'paid']),
          affectsBonus,
          ...(affectsBonus ? { bonusPercentage } : {}),
          description: pick(EXPENSE_NOTES),
        }, `expense on project ${e.projectId}${affectsBonus ? ` (bonus, pool $${pool.toFixed(0)})` : ''}`);
        summary.expenses += 1;
        if (affectsBonus) summary.bonusExpenses += 1;
      }
    });

    if (ref.taskTypeIds.length) {
      await api.optional('project task', async () => {
        const s = randomWorkSlot(startOffset + randInt(1, 5));
        await api.mutate('PUT', '/task-schedules', {
          branchId: ref.branchId,
          taskTypeId: pick(ref.taskTypeIds),
          assignedToId: pick(ref.assigneeIds),
          title: pick(TASK_TITLES),
          startISO: isoAtTime(s.dayOffset, s.hour, s.minute),
          endISO: isoAtTime(s.dayOffset, s.hour + 1, s.minute),
          status: 'published',
          createsShift: false,
          projectId: e.projectId,
          notificationSettings: SILENT,
        }, `task on project ${e.projectId}`);
        summary.tasks += 1;
      });
    }

    if (Math.random() < 0.6) {
      await api.optional('review', async () => {
        const stars = Math.random() < 0.75 ? 5 : Math.random() < 0.7 ? 4 : 3;
        await api.mutate('POST', '/customer-reviews', { projectId: e.projectId, stars },
          `${stars}-star review on project ${e.projectId}`);
        summary.reviews += 1;
      });
    }

    if (summary.invoices < t.invoices && ref.paymentTermId) {
      await api.optional('invoice', async () => {
        const amount = randInt(1200, 9000);
        await api.mutate('POST', '/invoices', {
          projectId: e.projectId,
          estimateId: e.id,
          createMethod: 'new',
          issueDate: new Date().toISOString().slice(0, 10),
          paymentTermId: ref.paymentTermId,
          descriptionOfWork: 'Simulated work order.',
          lineItems: [{ description: 'Service', quantity: 1, unitPrice: amount, taxable: true }],
          status: 'open',
        }, `invoice for project ${e.projectId} ($${amount})`);
        summary.invoices += 1;
      });
    }
  }

  // 6 ── scatter the leads that never converted
  onStep({ kind: 'stage', text: `Stage 6/7 — scattering ${Math.max(0, leads.length - t.visits)} leads` });
  const scatterable = scatterableStatuses(ref);
  for (const lead of leads.slice(t.visits)) {
    await api.optional('scatter', async () => {
      await api.mutate('PATCH', `/leads/${lead.id}`, { status: pick(scatterable).id },
        `lead ${lead.id} → scattered`);
      summary.scattered += 1;
    });
  }

  // 7 ── fill the calendar around the work
  onStep({ kind: 'stage', text: `Stage 7/7 — calendar, 45d back through ${horizon}d ahead` });
  for (let i = 0; i < Math.max(1, Math.round(t.leads / 3)); i += 1) {
    if (!ref.taskTypeIds.length) break;
    await api.optional('calendar task', async () => {
      const off = randInt(-45, horizon);
      const s = randomWorkSlot(off);
      await api.mutate('PUT', '/task-schedules', {
        branchId: ref.branchId,
        taskTypeId: pick(ref.taskTypeIds),
        assignedToId: pick(ref.assigneeIds),
        title: pick(TASK_TITLES),
        startISO: isoAtTime(s.dayOffset, s.hour, s.minute),
        endISO: isoAtTime(s.dayOffset, s.hour + 1, s.minute),
        status: 'published',
        createsShift: false,
        notificationSettings: SILENT,
      }, `task ${off >= 0 ? `in ${off}d` : `${-off}d ago`}`);
      summary.tasks += 1;
    });
  }
  for (let i = 0; i < Math.max(1, Math.round(t.leads / 6)); i += 1) {
    await api.optional('time off', async () => {
      const off = randInt(-30, horizon);
      const len = randInt(1, 4);
      await api.mutate('PUT', '/time-off-schedules', {
        branchId: ref.branchId,
        personId: pick(ref.assigneeIds),
        reason: pick(['sick', 'vacation', 'other']),
        startISO: isoAtOffset(off, 0),
        endISO: isoAtOffset(off + len, 23),
        description: 'Simulated time off.',
      }, `time off, ${len}d`);
      summary.timeOff += 1;
    });
  }

  logger.info(`Simulation finished: ${api.mutations.count} mutations`);
  return { summary, mutations: api.mutations.count };
}
