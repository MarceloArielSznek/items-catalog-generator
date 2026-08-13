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
// Slug of the lead source every seeded lead is filed under, so re-runs can
// count exactly what this tool created (and an operator can bulk-delete it).
const DEMO_MARKER = 'demo-seed';
const DEMO_SOURCE_NAME = 'Demo Seed';

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
/**
 * One call against the Menaia NestJS API with the org-bound service key. Same
 * bearer the deploy uses — demo data no longer signs in as a real user, so
 * there is no session, cookie or Supabase round-trip on this path.
 */
async function apiCall(baseUrl, apiKey, method, pathName, body) {
  const base = baseUrl.replace(/\/+$/, '');
  const root = base.endsWith('/v1') ? base : `${base}/v1`;
  const res = await fetch(`${root}${pathName}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let result;
  try { result = text ? JSON.parse(text) : null; } catch { result = text; }
  if (!res.ok) {
    const message = result?.message || result?.errors?.[0]?.message || result || res.statusText;
    throw new Error(`${method} /v1${pathName.split('?')[0]} -> ${res.status}: ${message}`);
  }
  return result;
}

// Lists paginate as `{ data, meta: { pagination: { pageCount } } }`.
async function listAll(baseUrl, apiKey, collection, params = {}) {
  const docs = [];
  let page = 1;
  let pageCount = 1;
  do {
    const query = new URLSearchParams({ pageSize: '100', page: String(page), ...params });
    const result = await apiCall(baseUrl, apiKey, 'GET', `/${collection}?${query}`);
    docs.push(...(result?.data || []));
    pageCount = Number(result?.meta?.pagination?.pageCount) || 1;
    page += 1;
  } while (page <= pageCount);
  return docs;
}

// `pageSize=1` — we only want the total off the pagination envelope.
async function countLeads(baseUrl, apiKey, params) {
  const query = new URLSearchParams({ pageSize: '1', page: '1', ...params });
  const result = await apiCall(baseUrl, apiKey, 'GET', `/leads?${query}`);
  return Number(result?.meta?.pagination?.total) || 0;
}

// Upload one avatar via the admin avatar routes: presign -> PUT -> register.
async function uploadUserAvatar(baseUrl, apiKey, userId, fileBuffer, filename) {
  const filesize = fileBuffer.length;
  const presign = await apiCall(baseUrl, apiKey, 'POST', `/users/${userId}/avatar/upload-url`, {
    mimeType: 'image/jpeg', originalFilename: filename, filesize,
  });
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.uploadHeaders, body: fileBuffer });
  if (!put.ok) throw new Error(`avatar PUT failed (${put.status})`);
  const registered = await apiCall(baseUrl, apiKey, 'POST', `/users/${userId}/avatar`, {
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

/**
 * The dedicated lead source every seeded lead is filed under. It is what makes
 * re-runs idempotent: counting leads on it per branch is exact, where counting
 * all leads in a branch would also count real ones. Created on first run.
 */
async function ensureDemoSource(baseUrl, apiKey, existingSources) {
  const found = existingSources.find((s) => s.slug === DEMO_MARKER || s.name === DEMO_SOURCE_NAME);
  if (found) return found;
  const created = await apiCall(baseUrl, apiKey, 'POST', '/lead-sources', {
    name: DEMO_SOURCE_NAME,
    slug: DEMO_MARKER,
    description: 'Sample leads created by the catalog generator. Safe to delete.',
    isActive: true,
  });
  return created;
}

/**
 * Resolve the live target with the service key: the org it is bound to, plus
 * the branches, lead statuses and lead sources the seeder needs. Shared by the
 * dry run and the run so both see the same org.
 */
async function connectAndResolve(org, options) {
  const { apiUrl, apiKey } = options;
  const organization = await apiCall(apiUrl, apiKey, 'GET', '/organization/me');
  const orgId = organization?.id;
  if (!orgId) throw new Error('Could not resolve the organization from /v1/organization/me');

  const branches = await listAll(apiUrl, apiKey, 'branches');
  if (branches.length === 0) throw new Error('No branches visible to this API key — deploy the org first');
  const leadStatuses = await listAll(apiUrl, apiKey, 'lead-statuses');
  const leadSources = await listAll(apiUrl, apiKey, 'lead-sources');

  return { orgId, orgName: organization?.name ?? null, branches, leadStatuses, leadSources };
}

/**
 * Dry run: resolve the live org the key is bound to and report what a populate
 * would create (avatars available, leads per branch minus what is already
 * seeded) plus a `confirmation` token to echo back. Read-only.
 */
export async function planDemoData(org, options) {
  const { apiUrl, apiKey } = options;
  const { orgId, orgName, branches, leadStatuses, leadSources } = await connectAndResolve(org, options);
  const leadsPerBranch = leadsPerBranchOf(options);
  const includeAvatars = options.includeAvatars !== false;

  const avatarsAvailable = (org.users || []).filter((u) => fs.existsSync(avatarFile(org.slug, u.email))).length;

  // Read-only: if the demo source does not exist yet nothing has been seeded.
  const demoSource = leadSources.find((s) => s.slug === DEMO_MARKER || s.name === DEMO_SOURCE_NAME) || null;

  const branchPlan = [];
  let leadsToCreate = 0;
  for (const branch of branches) {
    const already = demoSource
      ? await countLeads(apiUrl, apiKey, { branch: String(branch.id), leadSource: String(demoSource.id) })
      : 0;
    const willCreate = Math.max(0, leadsPerBranch - already);
    leadsToCreate += willCreate;
    branchPlan.push({ name: branch.name, already, willCreate });
  }

  return {
    target: {
      id: orgId,
      name: orgName || org.name,
      slug: org.slug,
      apiUrl,
      branchCount: branches.length,
    },
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
  const { apiUrl, apiKey } = options;
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
    step('resolve', 'running');
    const { orgId, orgName, branches, leadStatuses, leadSources } = await connectAndResolve(org, options);

    // Guard rail: the run must target the exact org the dry run confirmed. The
    // key already scopes to one org, but echoing the confirmation token makes
    // the operator's intent explicit (same contract as the deploy).
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
      // One listing for the whole loop: the deploy just created these users.
      const orgUsers = await listAll(apiUrl, apiKey, 'user-admins');
      const userIdByEmail = new Map(
        orgUsers.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u.id]),
      );
      for (const user of org.users || []) {
        const file = avatarFile(org.slug, user.email);
        if (!fs.existsSync(file)) continue;
        try {
          const targetUserId = userIdByEmail.get(String(user.email).toLowerCase());
          if (!targetUserId) { avatarFailures.push(`${user.email}: user not found`); continue; }
          const mediaId = await uploadUserAvatar(apiUrl, apiKey, targetUserId, fs.readFileSync(file), `${userKey(user.email)}.jpg`);
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
    const demoSource = await ensureDemoSource(apiUrl, apiKey, leadSources);
    let leadCount = 0;
    const leadFailures = [];
    let nameIdx = randInt(0, FIRST_NAMES.length - 1);
    for (const branch of branches) {
      // Idempotency: skip branches that already have our demo leads.
      const already = await countLeads(apiUrl, apiKey, {
        branch: String(branch.id),
        leadSource: String(demoSource.id),
      });
      if (already >= leadsPerBranch) {
        step('leads', 'running', `branch "${branch.name}" already seeded (${already}) — skipped`);
        continue;
      }
      // Branch address lives on the configuration's baseConstants.
      const branchAddress = branch.configuration?.baseConstants?.address || branch.address;
      const loc = parseBranchLocation(branchAddress);
      for (let i = already; i < leadsPerBranch; i++) {
        const firstName = pick(FIRST_NAMES, nameIdx);
        const lastName = pick(LAST_NAMES, nameIdx * 3 + i);
        nameIdx += 1;
        const status = leadStatuses.length ? pick(leadStatuses, leadCount) : null; // round-robin → realistic board
        try {
          // `contacts` is part of the create body — no separate contact call.
          const lead = await apiCall(apiUrl, apiKey, 'POST', '/leads', {
            branchId: branch.id,
            leadSourceId: demoSource.id,
            contacts: [{
              isPrimary: true,
              firstName,
              lastName,
              email: `${firstName}.${lastName}.${Date.now()}${i}@example.com`.toLowerCase(),
              phone: `+1${randInt(200, 989)}${randInt(200, 989)}${String(randInt(0, 9999)).padStart(4, '0')}`,
            }],
            address: `${randInt(100, 9999)} ${rand(STREETS)}`,
            city: loc.city ?? undefined,
            state: loc.state ?? undefined,
            postalCode: loc.postalCode ?? undefined,
            notes: rand(LEAD_NOTES),
          });
          // Create always files a lead under the org's "new" status, so spread
          // them across the pipeline afterwards. Non-fatal: the lead exists.
          if (status?.id && lead?.id && lead.status?.id !== status.id) {
            try {
              await apiCall(apiUrl, apiKey, 'PATCH', `/leads/${lead.id}`, { status: status.id });
            } catch (err) {
              logger.warn(`[demo-data] status update failed for lead ${lead.id}: ${err.message}`);
            }
          }
          action('leads', 'created', `${firstName} ${lastName} (${branch.name})`, lead?.id);
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
