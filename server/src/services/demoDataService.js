import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

// User avatars are stored locally by the generator at
// generated-orgs/user-avatars/<slug>/<emailKey>.jpg — mirror orgRoutes' key.
const USER_AVATARS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../generated-orgs/user-avatars');
function userKey(email) {
  return (email || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
function avatarFile(slug, email) {
  return path.join(USER_AVATARS_ROOT, slug, `${userKey(email)}.jpg`);
}

// ── Demo identities (fake leads). Kept small + generic; any industry. ─────────
const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Nancy', 'Matthew', 'Lisa',
];
const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
];
const STREETS = [
  'Maple Ave', 'Oak St', 'Pine St', 'Cedar Ln', 'Elm St', 'Washington Ave', 'Park Blvd',
  'Sunset Dr', 'Hillcrest Rd', 'Lakeview Dr', 'Meadow Ln', 'Riverside Dr', 'Birch St',
  'Willow Way', 'Highland Ave', 'Valley Rd', 'Spring St', 'Forest Ave', 'Brookside Dr',
];
const LEAD_NOTES = [
  'Requested a quote after seeing our work in the neighborhood.',
  'Referred by a previous customer. Looking to schedule an estimate.',
  'Called in about a project — wants pricing and availability.',
  'Submitted an inquiry through the website contact form.',
  'Interested in a full assessment. Flexible on timing.',
  'Repeat customer exploring a new project for their property.',
];
// Queryable top-level marker so re-runs are idempotent per branch.
const DEMO_MARKER = 'demo-seed';

const pick = (arr, i) => arr[i % arr.length];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Parse a single-line US branch address into { city, state, postalCode } so
 * seeded leads land in the same zone as the business. Falls back to nulls when
 * the format doesn't match "..., City, ST 12345".
 *   "9275 Trade Pl Unit H, San Diego, CA 92126" → { city:'San Diego', state:'CA', postalCode:'92126' }
 */
function parseBranchLocation(address) {
  const out = { city: null, state: null, postalCode: null };
  if (!address) return out;
  const parts = String(address).split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const tail = parts[parts.length - 1]; // "CA 92126"
    const m = tail.match(/([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?/);
    if (m) {
      out.state = m[1].toUpperCase();
      out.postalCode = m[2];
      out.city = parts[parts.length - 2] || null;
    } else {
      // No "ST ZIP" tail — treat last token as city.
      out.city = parts[parts.length - 1] || null;
    }
  }
  return out;
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function buildSupabaseCookie(supabaseUrl, session) {
  const ref = new URL(supabaseUrl).hostname.split('.')[0];
  const name = `sb-${ref}-auth-token`;
  const payload = JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type ?? 'bearer',
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    user: session.user,
  });
  const b64 = 'base64-' + Buffer.from(payload).toString('base64');
  const CHUNK = 3180;
  const chunks = [];
  for (let i = 0; i < b64.length; i += CHUNK) chunks.push(b64.slice(i, i + CHUNK));
  return chunks.map((c, i) => `${name}.${i}=${c}`).join('; ');
}

/**
 * Authenticate as a REAL user via the Supabase password grant. The returned
 * `accessToken` is a Bearer for the NestJS `/v1` API (avatars); the `cookie` is
 * the chunked `sb-<ref>-auth-token` the Payload REST `/api` expects (leads).
 * One login serves both.
 */
async function authenticateAsUser({ supabaseUrl, anonKey, email, password }) {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
  const session = await res.json().catch(() => null);
  if (!res.ok || !session?.access_token) {
    const reason = session?.error_description || session?.msg || session?.message || res.statusText;
    throw new Error(`Admin sign-in failed (${email}): ${reason}`);
  }
  return {
    accessToken: session.access_token,
    cookie: buildSupabaseCookie(supabaseUrl, session),
    userId: session.user?.id || null,
    email: session.user?.email || email,
  };
}

function payloadBaseUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
}

async function payloadCall(baseUrl, cookie, method, pathAndQuery, body) {
  const res = await fetch(`${payloadBaseUrl(baseUrl)}${pathAndQuery}`, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let result;
  try { result = text ? JSON.parse(text) : null; } catch { result = text; }
  if (!res.ok) {
    const fieldErr = result?.errors?.[0]?.data?.errors?.[0];
    const message = (fieldErr && `${fieldErr.path}: ${fieldErr.message}`)
      || result?.errors?.[0]?.message || result?.message || result || res.statusText;
    throw new Error(`${method} /api${pathAndQuery.split('?')[0]} -> ${res.status}: ${message}`);
  }
  return result;
}

function v1BaseUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

async function v1Call(baseUrl, token, orgId, method, pathName, body) {
  const res = await fetch(`${v1BaseUrl(baseUrl)}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Organization-Id': String(orgId),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let result;
  try { result = text ? JSON.parse(text) : null; } catch { result = text; }
  if (!res.ok) {
    const message = result?.message || result?.error?.message || result || res.statusText;
    throw new Error(`${method} /v1${pathName} -> ${res.status}: ${message}`);
  }
  return result;
}

// Upload one avatar via the NestJS admin route (manage:User). presign → PUT → register.
async function uploadUserAvatar(apiUrl, token, orgId, userId, fileBuffer, filename) {
  const filesize = fileBuffer.length;
  const presign = await v1Call(apiUrl, token, orgId, 'POST', `/users/${userId}/avatar/upload-url`, {
    mimeType: 'image/jpeg', originalFilename: filename, filesize,
  });
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.uploadHeaders, body: fileBuffer });
  if (!put.ok) throw new Error(`avatar PUT failed (${put.status})`);
  const registered = await v1Call(apiUrl, token, orgId, 'POST', `/users/${userId}/avatar`, {
    prefix: presign.prefix, filename: presign.filename, mimeType: 'image/jpeg', filesize,
  });
  return registered?.mediaId ?? null;
}

const leadsPerBranchOf = (options) =>
  Number.isFinite(Number(options.leadsPerBranch)) ? Number(options.leadsPerBranch) : 5;

// Confirmation token the UI must echo back before a run — same idea as the
// deploy's `${id}:${slug}`, so the operator verifies the exact target org.
function demoConfirmation(orgId, slug) {
  return `${orgId}:${slug}`;
}

// Count how many demo leads a branch already has (idempotency / plan).
async function countSeededLeads(options, cookie, branchId) {
  const res = await payloadCall(options.payloadUrl, cookie, 'GET',
    `/leads?where[branch][equals]=${branchId}&where[sourceUrl][equals]=${DEMO_MARKER}&limit=0&depth=0`);
  return res?.totalDocs || 0;
}

/**
 * Sign in as the org admin and resolve the live target (org id/name, branches,
 * lead statuses + sources). Shared by the dry run and the run so both see the
 * exact same org — the admin cookie is org-scoped, so this is authoritative.
 */
async function connectAndResolve(org, options) {
  const auth = await authenticateAsUser({
    supabaseUrl: options.supabaseUrl,
    anonKey: options.anonKey,
    email: options.adminEmail,
    password: options.adminPassword,
  });
  // depth=2 populates configuration.baseConstants (where the branch address lives).
  const branchesRes = await payloadCall(options.payloadUrl, auth.cookie, 'GET', '/branches?limit=100&depth=2');
  const branches = branchesRes?.docs || [];
  if (branches.length === 0) throw new Error('No branches visible to this admin — deploy the org first');
  const orgRel = branches[0].organization;
  const orgId = typeof orgRel === 'object' ? orgRel.id : orgRel;
  const orgName = typeof orgRel === 'object' ? orgRel.name : null;
  const statusesRes = await payloadCall(options.payloadUrl, auth.cookie, 'GET',
    `/statuses?where[organization][equals]=${orgId}&where[type][equals]=lead&limit=50&depth=0`);
  const leadStatuses = statusesRes?.docs || [];
  const sourcesRes = await payloadCall(options.payloadUrl, auth.cookie, 'GET',
    `/lead-sources?where[organization][equals]=${orgId}&limit=50&depth=0`);
  const leadSources = sourcesRes?.docs || [];
  return { auth, orgId, orgName, branches, leadStatuses, leadSources };
}

/**
 * Dry run: authenticate, resolve the live org the admin is bound to, and report
 * what a populate would create (avatars available, leads per branch minus what's
 * already seeded) plus a `confirmation` token to echo back. Read-only.
 */
export async function planDemoData(org, options) {
  const { auth, orgId, orgName, branches, leadStatuses, leadSources } = await connectAndResolve(org, options);
  const leadsPerBranch = leadsPerBranchOf(options);
  const includeAvatars = options.includeAvatars !== false;

  const avatarsAvailable = (org.users || []).filter((u) => fs.existsSync(avatarFile(org.slug, u.email))).length;

  const branchPlan = [];
  let leadsToCreate = 0;
  for (const branch of branches) {
    const already = await countSeededLeads(options, auth.cookie, branch.id);
    const willCreate = Math.max(0, leadsPerBranch - already);
    leadsToCreate += willCreate;
    branchPlan.push({ name: branch.name, already, willCreate });
  }

  return {
    target: {
      id: orgId,
      name: orgName || org.name,
      slug: org.slug,
      payloadUrl: options.payloadUrl,
      branchCount: branches.length,
    },
    actor: { email: auth.email },
    confirmation: demoConfirmation(orgId, org.slug),
    leadsPerBranch,
    avatars: { available: avatarsAvailable, willUpload: includeAvatars ? avatarsAvailable : 0 },
    leads: { perBranch: leadsPerBranch, willCreate: leadsToCreate, branches: branchPlan },
    resources: { statuses: leadStatuses.length, sources: leadSources.length },
  };
}

/**
 * Populate a freshly-deployed org with demo records so the recipient has things
 * to "play with": user avatars + N leads per branch (with contacts), addressed
 * in the business's zone. Idempotent — skips branches already seeded and avatars
 * are one-row-per-user (register replaces). Resilient — per-row try/catch never
 * aborts the run. Streams progress via `onStep` (same shape as deployOrg).
 */
export async function seedDemoData(org, options, onStep) {
  const log = [];
  const actions = [];
  function step(name, status, detail = '') {
    const entry = { name, status, detail, ts: new Date().toISOString() };
    log.push(entry);
    onStep?.(entry);
    logger.info(`[demo-data] ${name}: ${status} ${detail}`);
  }
  function action(collection, operation, name, id) {
    actions.push({ collection, operation, name, id, ts: new Date().toISOString() });
  }

  const leadsPerBranch = leadsPerBranchOf(options);
  const includeAvatars = options.includeAvatars !== false;

  try {
    step('auth', 'running', `Signing in as ${options.adminEmail}`);
    const { auth, orgId, orgName, branches, leadStatuses, leadSources } = await connectAndResolve(org, options);
    step('auth', 'done', `Authenticated as ${auth.email}`);

    // Guard rail: the run must target the exact org the dry run confirmed. The
    // admin cookie already scopes to one org, but echoing the confirmation token
    // makes the operator's intent explicit (same contract as the deploy).
    step('resolve', 'running');
    const expected = demoConfirmation(orgId, org.slug);
    if (options.confirmation && options.confirmation !== expected) {
      throw new Error(`Confirmation must match the resolved target "${expected}" (got "${options.confirmation}")`);
    }
    step('resolve', 'done', `${orgName || org.name} (org ${orgId}) · ${branches.length} branch(es) · ${leadStatuses.length} status(es) · ${leadSources.length} source(s)`);

    // ── Avatars ────────────────────────────────────────────────────────────────
    if (includeAvatars) {
      step('avatars', 'running');
      let avatarCount = 0;
      const avatarFailures = [];
      for (const user of org.users || []) {
        const file = avatarFile(org.slug, user.email);
        if (!fs.existsSync(file)) continue;
        try {
          // Resolve the Menaia user id by email (Payload Users collection).
          const found = await payloadCall(options.payloadUrl, auth.cookie, 'GET',
            `/users?where[email][equals]=${encodeURIComponent(user.email)}&limit=1&depth=0`);
          const targetUserId = found?.docs?.[0]?.id;
          if (!targetUserId) { avatarFailures.push(`${user.email}: user not found`); continue; }
          const mediaId = await uploadUserAvatar(options.apiUrl, auth.accessToken, orgId, targetUserId, fs.readFileSync(file), `${userKey(user.email)}.jpg`);
          action('user-avatars', 'created', user.email, mediaId);
          avatarCount += 1;
        } catch (err) {
          avatarFailures.push(`${user.email}: ${err.message}`);
          logger.warn(`[demo-data] avatar failed for ${user.email}: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      if (avatarFailures.length) {
        step('avatars', 'failed', `${avatarCount} uploaded, ${avatarFailures.length} failed — e.g. ${avatarFailures[0]}`);
      } else {
        step('avatars', 'done', `${avatarCount} avatar(s) uploaded`);
      }
    } else {
      step('avatars', 'done', 'skipped');
    }

    // ── Leads (with contacts), N per branch, addressed in the branch zone ───────
    step('leads', 'running');
    let leadCount = 0;
    const leadFailures = [];
    let nameIdx = randInt(0, FIRST_NAMES.length - 1);
    for (const branch of branches) {
      // Idempotency: skip branches that already have our demo leads.
      const existing = await payloadCall(options.payloadUrl, auth.cookie, 'GET',
        `/leads?where[branch][equals]=${branch.id}&where[sourceUrl][equals]=${DEMO_MARKER}&limit=0&depth=0`);
      const already = existing?.totalDocs || 0;
      if (already >= leadsPerBranch) {
        step('leads', 'running', `branch "${branch.name}" already seeded (${already}) — skipped`);
        continue;
      }
      // Branch address lives on the configuration's baseConstants (Menaia /v1),
      // falling back to a flat `address` if a future shape exposes one.
      const branchAddress = branch.configuration?.baseConstants?.address || branch.address;
      const loc = parseBranchLocation(branchAddress);
      for (let i = already; i < leadsPerBranch; i++) {
        const firstName = pick(FIRST_NAMES, nameIdx);
        const lastName = pick(LAST_NAMES, nameIdx * 3 + i);
        nameIdx += 1;
        const status = leadStatuses.length ? pick(leadStatuses, leadCount) : null; // round-robin → realistic board
        const source = leadSources.length ? rand(leadSources) : null;
        try {
          const contact = await payloadCall(options.payloadUrl, auth.cookie, 'POST', '/contacts', {
            organization: orgId,
            firstName,
            lastName,
            email: `${firstName}.${lastName}.${Date.now()}${i}@example.com`.toLowerCase(),
            phone: `+1${randInt(200, 989)}${randInt(200, 989)}${String(randInt(0, 9999)).padStart(4, '0')}`,
          });
          const contactId = contact?.doc?.id;
          const lead = await payloadCall(options.payloadUrl, auth.cookie, 'POST', '/leads', {
            organization: orgId,
            branch: branch.id,
            primaryContact: contactId,
            status: status?.id ?? undefined,
            source: source?.id ?? undefined,
            channel: 'manual-entry',
            address: `${randInt(100, 9999)} ${rand(STREETS)}`,
            city: loc.city ?? undefined,
            state: loc.state ?? undefined,
            postalCode: loc.postalCode ?? undefined,
            notes: rand(LEAD_NOTES),
            sourceUrl: DEMO_MARKER,
            metadata: { demoSeed: true },
          });
          action('leads', 'created', `${firstName} ${lastName} (${branch.name})`, lead?.doc?.id);
          leadCount += 1;
        } catch (err) {
          leadFailures.push(`${branch.name} #${i + 1}: ${err.message}`);
          logger.warn(`[demo-data] lead failed (${branch.name}): ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 120));
      }
    }
    if (leadFailures.length) {
      step('leads', 'failed', `${leadCount} created, ${leadFailures.length} failed — e.g. ${leadFailures[0]}`);
    } else {
      step('leads', 'done', `${leadCount} lead(s) created across ${branches.length} branch(es)`);
    }

    step('complete', 'done', `Seeded ${actions.length} demo record(s) into org ${orgId}`);
    return { success: true, log, actions, organizationId: orgId };
  } catch (err) {
    step('error', 'failed', err.message);
    return { success: false, log, actions, error: err.message };
  }
}
