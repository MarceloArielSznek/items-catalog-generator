import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const PAGE_LIMIT = 100;

// Standard onboarding defaults. These are FIXED canonical lists (NOT sourced
// from the per-org draft) — every freshly deployed org gets the same set. All
// creation below is idempotent (reconcile against existing via listAll) and
// resilient (per-row try/catch, never aborting the deploy).
const DEFAULT_LEAD_STATUSES = [
  { name: 'New', slug: 'new', order: 1, category: 'new', color: 'info' },
  { name: 'In Progress', slug: 'in-progress', order: 2, category: 'in-progress', color: 'fuchsia' },
  { name: 'Scheduled', slug: 'scheduled', order: 3, category: 'in-progress', color: 'accent' },
  { name: 'Lost', slug: 'lost', order: 5, category: 'cancelled', color: 'error' },
  { name: 'Sold', slug: 'sold', order: 6, category: 'done', color: 'success' },
];

const DEFAULT_TAGS = ['Hot Lead', 'Follow-up', 'Referral'];

const DEFAULT_LEAD_SOURCES = [
  { name: 'Google Organic', slug: 'google-organic', sortOrder: 0, isDefault: true },
  { name: 'Bing Organic', slug: 'bing-organic', sortOrder: 1 },
  { name: 'Yahoo Organic', slug: 'yahoo-organic', sortOrder: 2 },
  { name: 'Google Ads', slug: 'google-ads', sortOrder: 3 },
  { name: 'Bing Ads', slug: 'bing-ads', sortOrder: 4 },
  { name: 'Yelp', slug: 'yelp', sortOrder: 5 },
  { name: 'AI Search Engine', slug: 'ai-search-engine', sortOrder: 6 },
  { name: 'Facebook Ads', slug: 'facebook-ads', sortOrder: 7 },
  { name: 'Direct Traffic', slug: 'direct-traffic', sortOrder: 8 },
  { name: 'Cold Call', slug: 'cold-call', sortOrder: 9 },
  { name: 'Email', slug: 'email', sortOrder: 10 },
  { name: 'ThumbTack', slug: 'thumbtack', sortOrder: 11 },
  { name: 'Canvasser/D2D', slug: 'canvasserd2d', sortOrder: 12 },
  { name: 'B2B Referral', slug: 'b2b-referral', sortOrder: 13, internalReferralInfo: 'required' },
  { name: 'Self Generated', slug: 'self-generated', sortOrder: 14, internalReferralInfo: 'required', externalReferralInfo: 'optional' },
  { name: 'Social Media', slug: 'social-media', sortOrder: 15 },
  { name: 'Home Show', slug: 'home-show', sortOrder: 16 },
  { name: 'Other', slug: 'other', sortOrder: 17 },
];

// NOTE: the API enum only accepts `invoice_void_reason` and
// `invoice_credit_reason` (credit_note_void reasons are intentionally omitted).
const DEFAULT_REASON_CODES = [
  { reasonType: 'invoice_void_reason', name: 'Duplicate Invoice', description: 'Invoice was created in error as a duplicate of an existing invoice.', sortOrder: 0 },
  { reasonType: 'invoice_void_reason', name: 'Incorrect Amount', description: 'The invoiced amount does not match the agreed-upon pricing.', sortOrder: 1 },
  { reasonType: 'invoice_void_reason', name: 'Customer Dispute', description: 'Customer has disputed the charges and invoice is being voided pending resolution.', sortOrder: 2 },
  { reasonType: 'invoice_void_reason', name: 'Job Cancelled', description: 'The associated job was cancelled before completion.', sortOrder: 3 },
  { reasonType: 'invoice_void_reason', name: 'Billing Error', description: 'Invoice was issued to the wrong client or project.', sortOrder: 4 },
  { reasonType: 'invoice_credit_reason', name: 'Goodwill Adjustment', description: 'Credit issued as a goodwill gesture to maintain client relationship.', sortOrder: 0 },
  { reasonType: 'invoice_credit_reason', name: 'Scope Reduction', description: 'Work scope was reduced after the original invoice was issued.', sortOrder: 1 },
  { reasonType: 'invoice_credit_reason', name: 'Quality Issue', description: 'Credit issued due to a quality concern reported by the client.', sortOrder: 2 },
  { reasonType: 'invoice_credit_reason', name: 'Pricing Error', description: 'The original invoice contained a pricing mistake that needs correction.', sortOrder: 3 },
  { reasonType: 'invoice_credit_reason', name: 'Promotional Discount', description: 'Post-invoice discount applied for a promotional offer.', sortOrder: 4 },
];

const DEFAULT_PAYMENT_TERMS = [
  { name: 'Due on Receipt', daysUntilDue: 0, isDefault: true },
  { name: 'Net 15', daysUntilDue: 15 },
  { name: 'Net 30', daysUntilDue: 30 },
  { name: 'Net 45', daysUntilDue: 45 },
  { name: 'Net 60', daysUntilDue: 60 },
];

// Locally-enriched item images live at generated-orgs/media/<slug>/<key>.jpg.
// The key derivation MIRRORS orgRoutes.imageKey — keep the two in sync.
const MEDIA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../generated-orgs/media');
// Org logos live at org-logos/<slug>/<variant>.png (mirrors orgRoutes.ORG_LOGOS_DIR).
const ORG_LOGOS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../org-logos');
function imageKey(categoryName, itemName) {
  const safe = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  return `${safe(categoryName)}__${safe(itemName)}`;
}

function humanize(s) {
  return String(s || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Menaia NestJS API base. The per-target org's `apiUrl` already points at the
// API host; we append `/v1` (the versioned API namespace) here.
function apiBaseUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

function requireArray(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function validateUniqueNames(items, path) {
  const seen = new Set();
  for (const item of requireArray(items, path)) {
    const name = String(item?.name || '').trim();
    if (!name) throw new Error(`${path} contains an entry without a name`);
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`${path} contains duplicate name "${name}"`);
    seen.add(key);
  }
}

function validateReferences(names, validNames, path) {
  for (const name of names || []) {
    if (!validNames.has(name)) throw new Error(`${path} references unknown resource "${name}"`);
  }
}

export function validateOrgForDeployment(org) {
  if (!org?.name) throw new Error('Organization name is required');
  if (!org?.slug) throw new Error('Organization slug is required');
  if (!org?.domain) throw new Error('Organization domain is required');
  if (!org?.timezone) throw new Error('Organization timezone is required');
  if (!org?.resources) throw new Error('Organization resources are required');

  validateUniqueNames(org.resources.factors, 'resources.factors');
  validateUniqueNames(org.resources.additionalCosts || [], 'resources.additionalCosts');
  validateUniqueNames(org.resources.multiplierRanges, 'resources.multiplierRanges');
  validateUniqueNames(org.resources.categories, 'resources.categories');
  validateUniqueNames(org.resources.workAreas, 'resources.workAreas');
  validateUniqueNames(org.branches, 'branches');

  const factorNames = new Set(org.resources.factors.map((item) => item.name));
  const additionalCostNames = new Set((org.resources.additionalCosts || []).map((item) => item.name));
  const categoryNames = new Set(org.resources.categories.map((item) => item.name));
  const itemNames = new Set();

  for (const category of org.resources.categories) {
    validateReferences(category.factorNames, factorNames, `Category "${category.name}".factorNames`);
    requireArray(category.items, `category "${category.name}".items`);
    for (const item of category.items) {
      const name = String(item?.name || '').trim();
      if (!name) throw new Error(`Category "${category.name}" contains an item without a name`);
      const key = name.toLowerCase();
      if (itemNames.has(key)) throw new Error(`Duplicate item name "${name}"`);
      itemNames.add(key);
      if (!item.unit) throw new Error(`Item "${name}" is missing unit`);
      if (!Number.isFinite(Number(item.materialCost))) throw new Error(`Item "${name}" has invalid materialCost`);
      if (!Number.isFinite(Number(item.laborHours))) throw new Error(`Item "${name}" has invalid laborHours`);
      validateReferences(item.factorNames, factorNames, `Item "${name}".factorNames`);
      validateReferences(item.additionalCostNames, additionalCostNames, `Item "${name}".additionalCostNames`);
    }
  }

  for (const workArea of org.resources.workAreas) {
    validateReferences(workArea.categories, categoryNames, `Work area "${workArea.name}".categories`);
    validateReferences(workArea.factorNames, factorNames, `Work area "${workArea.name}".factorNames`);
  }

  return true;
}

/**
 * Authenticate against the Menaia NestJS API with a per-target service-account
 * API key (format `mk_live_…`). The key is bound to exactly one organization,
 * so it scopes every request — no Supabase password grant, no cookies.
 *
 * New `options.credentials` shape: `{ apiKey }`
 *   (replaces the old `{ email, password, supabaseUrl, publishableKey, vercelToken }`).
 *
 * Returns `{ headers, user }` where `headers` carry the bearer token and
 * `user` is the calling principal/actor resolved from `GET /v1/me`.
 */
async function authenticate(credentials, baseUrl) {
  const apiKey = credentials?.apiKey || env.MENAIA_API_KEY;
  if (!apiKey) throw new Error('A Menaia API key (credentials.apiKey) is required');

  const auth = {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    user: null,
  };

  // Resolve the calling principal (actor) + bound org from /v1/me.
  const me = await apiCall(baseUrl || env.MENAIA_API_URL, auth, 'GET', '/me');
  auth.user = {
    id: me?.user?.id ?? null,
    email: me?.user?.email ?? null,
    organizationId: me?.organization?.id ?? null,
    organizationName: me?.organization?.name ?? null,
    principal: me?.principal ?? null,
  };
  return auth;
}

async function apiCall(baseUrl, auth, method, path, body) {
  const response = await fetch(`${apiBaseUrl(baseUrl)}${path}`, {
    method,
    headers: auth.headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : null; } catch { result = text; }
  if (!response.ok) {
    const message = result?.errors?.[0]?.message || result?.message || result || response.statusText;
    throw new Error(`${method} /v1${path} -> ${response.status}: ${message}`);
  }
  return result;
}

// Lists paginate as `{ data: [...], meta: { pagination: { page, pageCount, ... } } }`.
// Loop pages until `page > pageCount`, collecting `.data`.
async function listAll(baseUrl, auth, collection, params = {}) {
  const docs = [];
  let page = 1;
  let pageCount = 1;
  do {
    const query = new URLSearchParams({ pageSize: String(PAGE_LIMIT), page: String(page), ...params });
    const result = await apiCall(baseUrl, auth, 'GET', `/${collection}?${query}`);
    docs.push(...(result?.data || []));
    pageCount = Number(result?.meta?.pagination?.pageCount) || 1;
    page++;
  } while (page <= pageCount);
  return docs;
}

// The API key is bound to one org; `GET /v1/organization/me` returns that org.
async function resolveScopedOrganization(baseUrl, auth, expectedOrganizationId = null) {
  const organization = await apiCall(baseUrl, auth, 'GET', '/organization/me');
  if (!organization?.id) throw new Error('Could not resolve the scoped organization from /v1/organization/me');
  if (expectedOrganizationId != null && String(organization.id) !== String(expectedOrganizationId)) {
    throw new Error(`Authenticated organization changed: expected ${expectedOrganizationId}, found ${organization.id}`);
  }
  return organization;
}

function sameName(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function nameMap(docs) {
  return new Map(docs.map((doc) => [String(doc.name || '').trim().toLowerCase(), doc]));
}

function collectionPlan(label, desired, existing) {
  const existingByName = nameMap(existing);
  const create = [];
  const update = [];
  for (const item of desired) {
    const match = existingByName.get(String(item.name).trim().toLowerCase());
    (match ? update : create).push(match ? { name: item.name, id: match.id } : { name: item.name });
  }
  return { label, create, update, untouched: Math.max(0, existing.length - update.length) };
}

function flatItems(org) {
  return org.resources.categories.flatMap((category) => category.items);
}

// The API key scopes every list to the bound org, so no organization filter is
// passed. Each list collects the `.data` envelope across pages.
async function loadExisting(baseUrl, auth) {
  const [factors, additionalCosts, multiplierRanges, items, categories, workAreas, branches] = await Promise.all([
    listAll(baseUrl, auth, 'factors'),
    listAll(baseUrl, auth, 'additional-costs'),
    listAll(baseUrl, auth, 'multiplier-ranges'),
    listAll(baseUrl, auth, 'items'),
    listAll(baseUrl, auth, 'item-categories'),
    listAll(baseUrl, auth, 'work-areas'),
    listAll(baseUrl, auth, 'branches'),
  ]);
  return { factors, additionalCosts, multiplierRanges, items, categories, workAreas, branches };
}

export async function preflightOrgDeployment(org, options) {
  validateOrgForDeployment(org);
  const auth = await authenticate(options.credentials, options.apiUrl);
  const organization = await resolveScopedOrganization(options.apiUrl, auth);
  const existing = await loadExisting(options.apiUrl, auth);
  const collections = [
    collectionPlan('Factors', org.resources.factors, existing.factors),
    collectionPlan('Additional costs', org.resources.additionalCosts || [], existing.additionalCosts),
    collectionPlan('Multiplier ranges', org.resources.multiplierRanges, existing.multiplierRanges),
    collectionPlan('Items', flatItems(org), existing.items),
    collectionPlan('Categories', org.resources.categories, existing.categories),
    collectionPlan('Work areas', org.resources.workAreas, existing.workAreas),
    collectionPlan('Branches', org.branches, existing.branches),
  ];
  return {
    target: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      domain: organization.domain,
      apiUrl: options.apiUrl.replace(/\/+$/, ''),
    },
    actor: auth.user,
    draftMatch: {
      name: sameName(organization.name, org.name),
      slug: sameName(organization.slug, org.slug),
      domain: sameName(organization.domain, org.domain),
    },
    confirmation: `${organization.id}:${organization.slug || organization.domain || organization.name}`,
    collections,
    totals: collections.reduce((out, collection) => ({
      create: out.create + collection.create.length,
      update: out.update + collection.update.length,
      untouched: out.untouched + collection.untouched,
    }), { create: 0, update: 0, untouched: 0 }),
    // What the deploy ALSO provisions beyond the price book above (onboarding
    // defaults + draft fleet/users). Counts of what will be created on a fresh
    // org; re-deploys reconcile and skip existing.
    additional: {
      leadStatuses: DEFAULT_LEAD_STATUSES.length,
      tags: DEFAULT_TAGS.length,
      leadSources: DEFAULT_LEAD_SOURCES.length,
      reasonCodes: DEFAULT_REASON_CODES.length,
      vehicleTypes: new Set((org.resources.vehicleTemplates || []).map((v) => v.type)).size,
      vehicles: org.resources.vehicleTemplates?.length || 0,
      equipmentTypes: org.resources.equipmentTypes?.length || 0,
      users: org.users?.length || 0,
      paymentTerms: DEFAULT_PAYMENT_TERMS.length * (org.branches?.length || 0),
      images: flatItems(org).filter((item) => item.imageUrl).length,
    },
  };
}

function resolveIds(names, idMap) {
  return (names || []).map((name) => idMap[name]).filter(Boolean);
}

async function upsertNamed(baseUrl, auth, collection, desired, existing, bodyFn, onAction) {
  const existingByName = nameMap(existing);
  const ids = {};
  for (const item of desired) {
    const match = existingByName.get(String(item.name).trim().toLowerCase());
    const body = bodyFn(item, match);
    const result = match
      ? await apiCall(baseUrl, auth, 'PATCH', `/${collection}/${match.id}`, body)
      : await apiCall(baseUrl, auth, 'POST', `/${collection}`, body);
    ids[item.name] = result.id;
    onAction?.(match ? 'updated' : 'created', item.name, result.id);
  }
  return ids;
}

/**
 * Build the flat branch write body accepted by Create/UpdateBranchSchema.
 * The /v1 branch schema is FLAT (no nested `baseConstants`) and is used for
 * BOTH `POST /v1/branches` and `PATCH /v1/branches/:id`. `multiplierRangeIds`
 * and `workAreaIds` carry the configuration's relations.
 *
 * NOTE: proposal-content + invoice-automation fields are NOT in this schema;
 * they're written via dedicated /branch-configurations sub-routes in the
 * branch loop (see the block at the end of this function).
 */
function branchWriteBody(branch, org, multiplierRangeIds, workAreaIds) {
  return {
    name: branch.name,
    address: branch.address || '',
    phone: branch.phone || '',
    timezone: branch.timezone || org.timezone,
    multiplierRangeIds,
    workAreaIds,
    baseHourlyRate: branch.baseHourlyRate,
    averageWorkDayHours: branch.averageWorkDayHours,
    wasteFactor: branch.wasteFactor,
    gasCost: branch.gasCost,
    truckAverageMPG: branch.truckAverageMPG,
    laborHoursLoadUnload: branch.laborHoursLoadUnload,
    subMultiplier: branch.subMultiplier,
    cashFactor: branch.cashFactor,
    maxDiscount: branch.maxDiscount,
    depositPercent: branch.depositPercent,
    maxDepositAmount: branch.maxDepositAmount,
    creditCardFee: branch.creditCardFee,
    minRetailPrice: branch.minRetailPrice,
    b2bMaxDiscount: branch.b2bMaxDiscount,
    qualityControlVisitPrice: branch.qualityControlVisitPrice,
    bonusPoolPercentage: Number(branch.bonusPoolPercentage || 0) / 100,
    bonusPayoutCutoff: branch.bonusPayoutCutoff,
    leaderboardColorPercentage: branch.leaderboardColorPercentage,
    maxOpenEstimates: branch.maxOpenEstimates,
    includeSubServicesInSalesPerformance: false,
    // Proposal content (defaultProposalEmailSubject/Body, financePartnerUrl,
    // contractorLicense, about, aboutVideoUrl, disclaimer, paymentTerms,
    // insuranceClaims, termsAndConditions) and invoice automations
    // (autoCreateDepositInvoice, autoSendDepositInvoice) are NOT in
    // Create/UpdateBranchSchema — they're written separately in the branch loop
    // via PATCH /branch-configurations/:id/proposal-content and /invoice-automations.
    // The config `name` is set server-side.
  };
}

// Three-step item-media upload: presign → PUT bytes to S3 → register → attach.
// NOTE: `register` only creates an orphan media row; unlike the org-logo flow
// it does NOT link the media to the item. The item↔media relation is owned by
// the item, so we must PATCH the item with `mediaIds` to attach it (which is
// what makes it show in "Item Media" and become the thumbnail server-side).
// The PATCH is a diff-sync (replaces the set), so re-deploys stay idempotent.
async function uploadItemImage(baseUrl, auth, itemId, fileBuffer, filename) {
  const filesize = fileBuffer.length;
  const presign = await apiCall(baseUrl, auth, 'POST', `/items/${itemId}/media/upload-url`, {
    mimeType: 'image/jpeg', originalFilename: filename, filesize,
  });
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.uploadHeaders, body: fileBuffer });
  if (!put.ok) throw new Error(`media PUT failed (${put.status})`);
  const registered = await apiCall(baseUrl, auth, 'POST', `/items/${itemId}/media/register`, {
    prefix: presign.prefix, filename: presign.filename, mimeType: 'image/jpeg', filesize,
  });
  const mediaId = registered?.mediaId;
  if (mediaId == null) throw new Error('register returned no mediaId');
  await apiCall(baseUrl, auth, 'PATCH', `/items/${itemId}`, { mediaIds: [mediaId] });
  return mediaId;
}

// Org-logo upload — same presign → PUT bytes → register flow as item media, but
// against the org-scoped /organization/me/logo endpoints (the API key is already
// bound to the target org, so no id is needed in the path).
async function uploadOrgLogo(baseUrl, auth, fileBuffer, filename) {
  const filesize = fileBuffer.length;
  const presign = await apiCall(baseUrl, auth, 'POST', '/organization/me/logo/upload-url', {
    mimeType: 'image/png', originalFilename: filename, filesize,
  });
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.uploadHeaders, body: fileBuffer });
  if (!put.ok) throw new Error(`logo PUT failed (${put.status})`);
  const registered = await apiCall(baseUrl, auth, 'POST', '/organization/me/logo', {
    prefix: presign.prefix, filename: presign.filename, mimeType: 'image/png', filesize,
  });
  return registered?.mediaId ?? registered?.id ?? null;
}

export async function deployOrg(org, options, onStep) {
  const log = [];
  const actions = [];
  const credentials = [];
  function step(name, status, detail = '') {
    const entry = { name, status, detail, ts: new Date().toISOString() };
    log.push(entry);
    onStep?.(entry);
    logger.info(`[deploy] ${name}: ${status} ${detail}`);
  }
  function action(collection, operation, name, id) {
    actions.push({ collection, operation, name, id, ts: new Date().toISOString() });
  }

  try {
    step('preflight', 'running');
    const auth = await authenticate(options.credentials, options.apiUrl);
    const organization = await resolveScopedOrganization(options.apiUrl, auth, options.expectedOrganizationId);
    const expectedConfirmation = `${organization.id}:${organization.slug || organization.domain || organization.name}`;
    if (options.confirmation !== expectedConfirmation) throw new Error(`Confirmation must exactly match "${expectedConfirmation}"`);
    validateOrgForDeployment(org);
    const existing = await loadExisting(options.apiUrl, auth);
    const orgId = organization.id;
    step('preflight', 'done', `Scoped to organization ${organization.name} (${orgId})`);

    // Standard onboarding defaults (fixed canonical lists, see module constants).
    // Idempotent: reconcile against existing via listAll, skip dupes, else POST.
    // Resilient: each row is wrapped in try/catch that logs + continues so a
    // single bad row never aborts the deploy.
    step('onboarding', 'running');
    let onboardingCount = 0;

    // 1. Lead statuses — dedupe by slug.
    const existingLeadStatuses = await listAll(options.apiUrl, auth, 'lead-statuses');
    const leadStatusSlugs = new Set(existingLeadStatuses.map((doc) => doc.slug));
    for (const status of DEFAULT_LEAD_STATUSES) {
      if (leadStatusSlugs.has(status.slug)) continue;
      try {
        const result = await apiCall(options.apiUrl, auth, 'POST', '/lead-statuses', { ...status });
        action('lead-statuses', 'created', status.name, result.id);
        onboardingCount += 1;
      } catch (err) {
        step('onboarding', 'running', `skipped lead-status ${status.name}: ${err.message}`);
      }
    }

    // 2. Tags — dedupe by name.
    const existingTags = await listAll(options.apiUrl, auth, 'tags');
    const tagNames = new Set(existingTags.map((doc) => String(doc.name || '').trim().toLowerCase()));
    for (const tag of DEFAULT_TAGS) {
      if (tagNames.has(tag.trim().toLowerCase())) continue;
      try {
        const result = await apiCall(options.apiUrl, auth, 'POST', '/tags', { name: tag, type: 'lead' });
        action('tags', 'created', tag, result.id);
        onboardingCount += 1;
      } catch (err) {
        step('onboarding', 'running', `skipped tag ${tag}: ${err.message}`);
      }
    }

    // 3. Lead sources — dedupe by slug.
    const existingLeadSources = await listAll(options.apiUrl, auth, 'lead-sources');
    const leadSourceSlugs = new Set(existingLeadSources.map((doc) => doc.slug));
    for (const source of DEFAULT_LEAD_SOURCES) {
      if (leadSourceSlugs.has(source.slug)) continue;
      try {
        const result = await apiCall(options.apiUrl, auth, 'POST', '/lead-sources', {
          ...source,
          isDefault: source.isDefault ?? false,
          internalReferralInfo: source.internalReferralInfo ?? 'none',
          externalReferralInfo: source.externalReferralInfo ?? 'none',
        });
        action('lead-sources', 'created', source.name, result.id);
        onboardingCount += 1;
      } catch (err) {
        step('onboarding', 'running', `skipped lead-source ${source.name}: ${err.message}`);
      }
    }

    // 4. Accounting reason codes — dedupe by (reasonType, name).
    const existingReasonCodes = await listAll(options.apiUrl, auth, 'accounting-reason-codes');
    const reasonCodeKeys = new Set(
      existingReasonCodes.map((doc) => `${doc.reasonType}::${String(doc.name || '').trim().toLowerCase()}`),
    );
    for (const code of DEFAULT_REASON_CODES) {
      const key = `${code.reasonType}::${code.name.trim().toLowerCase()}`;
      if (reasonCodeKeys.has(key)) continue;
      try {
        const result = await apiCall(options.apiUrl, auth, 'POST', '/accounting-reason-codes', {
          reasonType: code.reasonType,
          name: code.name,
          description: code.description,
          sortOrder: code.sortOrder,
        });
        action('accounting-reason-codes', 'created', code.name, result.id);
        onboardingCount += 1;
      } catch (err) {
        step('onboarding', 'running', `skipped reason-code ${code.name}: ${err.message}`);
      }
    }
    step('onboarding', 'done', `${onboardingCount} onboarding default(s) created`);

    // The API key scopes writes to the bound org, so the `organization` field is
    // dropped from every write body.
    step('resources', 'running');
    const factorIds = await upsertNamed(options.apiUrl, auth, 'factors', org.resources.factors, existing.factors, (item) => ({
      name: item.name,
      factor: item.factor,
      appliesTo: item.appliesTo,
      alwaysEnabled: item.alwaysEnabled || false,
    }), (op, name, id) => action('factors', op, name, id));
    const costIds = await upsertNamed(options.apiUrl, auth, 'additional-costs', org.resources.additionalCosts || [], existing.additionalCosts, (item) => ({
      name: item.name,
      cost: item.cost,
      appliesTo: item.appliesTo,
    }), (op, name, id) => action('additional-costs', op, name, id));
    const rangeIds = await upsertNamed(options.apiUrl, auth, 'multiplier-ranges', org.resources.multiplierRanges, existing.multiplierRanges, (item) => ({
      name: item.name,
      minCost: item.minCost,
      maxCost: item.maxCost ?? null,
      lowestMultiple: item.lowestMultiple,
      highestMultiple: item.highestMultiple,
    }), (op, name, id) => action('multiplier-ranges', op, name, id));
    step('resources', 'done');

    // In /v1 an item carries `itemCategoryIds` (min 1 required) — the link is
    // owned by the item, not the category — so categories must exist first.
    step('catalog', 'running');
    const categoryIds = await upsertNamed(options.apiUrl, auth, 'item-categories', org.resources.categories, existing.categories, (category) => ({
      name: category.name,
      factorIds: resolveIds(category.factorNames, factorIds),
    }), (op, name, id) => action('item-categories', op, name, id));
    step('catalog', 'done');

    // Items are nested under a category in the draft; stamp each with its
    // category id so the create satisfies the required `itemCategoryIds`.
    step('items', 'running');
    const itemsWithCategory = org.resources.categories.flatMap((category) =>
      (category.items || []).map((item) => ({ ...item, __categoryName: category.name })),
    );
    const itemIds = await upsertNamed(options.apiUrl, auth, 'items', itemsWithCategory, existing.items, (item) => ({
      name: item.name,
      // Menaia exposes a single item description field (`itemInfo`). We publish
      // the customer-facing `notes` there; the short technical `itemInfo` line
      // stays local as internal metadata and a fallback when notes is empty.
      itemInfo: item.notes || item.itemInfo || '',
      unit: item.unit,
      materialCost: item.materialCost,
      laborHours: item.laborHours,
      multiplierOverride: item.multiplierOverride ?? null,
      subItem: item.subItem || false,
      requiresInfo: item.requiresInfo || false,
      factorIds: resolveIds(item.factorNames, factorIds),
      additionalCostIds: resolveIds(item.additionalCostNames, costIds),
      itemCategoryIds: [categoryIds[item.__categoryName]].filter(Boolean),
    }), (op, name, id) => action('items', op, name, id));
    step('items', 'done');

    // Upload locally-enriched item images (generated-orgs/media/<slug>/...).
    // Per-image failures are skipped, not fatal, so the deploy still completes.
    step('images', 'running');
    let imageCount = 0;
    const imageFailures = [];
    for (const item of itemsWithCategory) {
      const itemId = itemIds[item.name];
      // Prefer the logo-composited variant (<key>__logo.jpg) — that's the branded
      // image the generator shows. Fall back to the base <key>.jpg when no logo
      // has been applied to this item.
      const key = imageKey(item.__categoryName, item.name);
      const logoFile = path.join(MEDIA_ROOT, org.slug, `${key}__logo.jpg`);
      const baseFile = path.join(MEDIA_ROOT, org.slug, `${key}.jpg`);
      const file = fs.existsSync(logoFile) ? logoFile : baseFile;
      if (!itemId || !fs.existsSync(file)) continue;
      try {
        const mediaId = await uploadItemImage(options.apiUrl, auth, itemId, fs.readFileSync(file), `${item.name}.jpg`);
        action('item-media', 'created', item.name, mediaId);
        imageCount += 1;
      } catch (err) {
        imageFailures.push(`${item.name}: ${err.message}`);
        logger.warn(`[deploy] item image upload failed for "${item.name}": ${err.message}`);
      }
    }
    // Surface failures instead of silently swallowing them: a non-zero failure
    // count marks the step failed (red) with the count + first error, and every
    // failure is warn-logged above. The deploy itself stays non-fatal.
    if (imageFailures.length) {
      step('images', 'failed', `${imageCount} uploaded, ${imageFailures.length} failed — e.g. ${imageFailures[0]}`);
    } else {
      step('images', 'done', `${imageCount} image(s) uploaded`);
    }

    // Upload the org logo (org-level branding) to the org-scoped logo endpoint.
    // Prefer the full-color variant, falling back through default/dark/white.
    // Non-fatal: a logo failure is warn-logged and surfaced but never aborts.
    step('logo', 'running');
    try {
      const logoDir = path.join(ORG_LOGOS_ROOT, org.slug);
      const variant = ['color', 'default', 'dark', 'white'].find((v) => fs.existsSync(path.join(logoDir, `${v}.png`)));
      if (!variant) {
        step('logo', 'done', 'no logo on file — skipped');
      } else {
        const mediaId = await uploadOrgLogo(options.apiUrl, auth, fs.readFileSync(path.join(logoDir, `${variant}.png`)), `${org.slug}-logo.png`);
        action('org-logo', 'created', variant, mediaId);
        step('logo', 'done', `uploaded ${variant} logo`);
      }
    } catch (err) {
      logger.warn(`[deploy] logo upload failed: ${err.message}`);
      step('logo', 'failed', `logo upload failed: ${err.message}`);
    }

    step('work-areas', 'running');
    const workAreaIds = await upsertNamed(options.apiUrl, auth, 'work-areas', org.resources.workAreas, existing.workAreas, (workArea) => ({
      name: workArea.name,
      itemCategoryIds: resolveIds(workArea.categories, categoryIds),
      factorIds: resolveIds(workArea.factorNames, factorIds),
    }), (op, name, id) => action('work-areas', op, name, id));
    step('work-areas', 'done');

    step('branches', 'running');
    const allRangeIds = Object.values(rangeIds);
    const allWorkAreaIds = Object.values(workAreaIds);
    const existingBranches = nameMap(existing.branches);
    const branchIdsByName = {};
    for (const branch of org.branches) {
      const match = existingBranches.get(branch.name.trim().toLowerCase());
      const body = branchWriteBody(branch, org, allRangeIds, allWorkAreaIds);

      // POST /v1/branches creates the branch + configuration AND seeds default
      // payment-methods/financing-terms/task-type in one call; the response
      // (BranchResponseSchema) carries the populated `configuration` (+ its id).
      // For an existing branch, PATCH /v1/branches/:id sets the full config
      // (flat baseConstants + multiplierRangeIds + workAreaIds) via
      // UpdateBranchSchema. CreateBranchSchema and UpdateBranchSchema are the
      // same flat body, so one `branchWriteBody` serves both.
      const branchResult = match
        ? await apiCall(options.apiUrl, auth, 'PATCH', `/branches/${match.id}`, body)
        : await apiCall(options.apiUrl, auth, 'POST', '/branches', body);
      action('branches', match ? 'updated' : 'created', branch.name, branchResult.id);
      branchIdsByName[branch.name] = branchResult.id;

      const configurationId = branchResult.configuration?.id || branchResult.configurationId;
      if (!configurationId) throw new Error(`Branch "${branch.name}" did not return a configuration`);

      // create SEEDS default financing-terms/payment-methods, so reconcile with
      // the seeded defaults (upsert-by-name) instead of blindly creating dupes.
      const [terms, methods] = await Promise.all([
        listAll(options.apiUrl, auth, 'branch-financing-terms', { branchConfigurationId: String(configurationId) }),
        listAll(options.apiUrl, auth, 'branch-payment-methods', { branchConfigurationId: String(configurationId) }),
      ]);

      // Financing terms are unique per (config, termMonths) and `create` already
      // seeded some — so reconcile by termMonths, not name, to avoid 409s.
      const termsByMonths = new Map(terms.map((t) => [Number(t.termMonths), t]));
      for (const term of branch.branchFinancingTerms || []) {
        const existingTerm = termsByMonths.get(Number(term.termMonths));
        const fields = {
          name: term.name,
          termMonths: term.termMonths,
          interestRate: term.interestRate,
          mostPopular: term.mostPopular || false,
        };
        const result = existingTerm
          ? await apiCall(options.apiUrl, auth, 'PATCH', `/branch-financing-terms/${existingTerm.id}`, fields)
          : await apiCall(options.apiUrl, auth, 'POST', '/branch-financing-terms', { branchConfigurationId: configurationId, ...fields });
        action('branch-financing-terms', existingTerm ? 'updated' : 'created', term.name, result.id);
      }

      // Payment methods are keyed by `label`; map onto the upsert's `name` key.
      const desiredMethods = (branch.branchPaymentMethods || []).map((method) => ({ ...method, name: method.label }));
      const existingMethods = methods.map((method) => ({ ...method, name: method.label }));
      await upsertNamed(options.apiUrl, auth, 'branch-payment-methods', desiredMethods, existingMethods, (method, existingMethod) => {
        const isFinancing = method.isFinancing ?? method.type === 'financing';
        return existingMethod
          ? {
              // UpdateBranchPaymentMethodSchema: non-partial, no branchConfigurationId.
              label: method.label,
              isFinancing,
              icon: method.icon,
              enabled: method.enabled ?? true,
              sortOrder: method.sortOrder ?? 0,
            }
          : {
              label: method.label,
              isFinancing,
              icon: method.icon,
              enabled: method.enabled ?? true,
              sortOrder: method.sortOrder ?? 0,
              branchConfigurationId: configurationId,
            };
      }, (op, name, id) => action('branch-payment-methods', op, name, id));

      // Branch-config content the create/update body doesn't carry: proposal
      // content (all 10 fields required) + invoice automations. Separate /v1
      // sub-routes, gated on manage:WorkspaceSettings (service-accessible).
      await apiCall(options.apiUrl, auth, 'PATCH', `/branch-configurations/${configurationId}/proposal-content`, {
        defaultProposalEmailSubject: branch.defaultProposalEmailSubject ?? '',
        defaultProposalEmailBody: branch.defaultProposalEmailBody ?? '',
        financePartnerUrl: branch.financePartnerUrl ?? '',
        contractorLicense: branch.contractorLicense ?? '',
        about: branch.about ?? '',
        aboutVideoUrl: branch.aboutVideoUrl ?? '',
        disclaimer: branch.disclaimer ?? '',
        paymentTerms: branch.paymentTerms ?? '',
        insuranceClaims: branch.insuranceClaims ?? '',
        termsAndConditions: branch.termsAndConditions ?? '',
      });
      action('branch-configurations', 'updated', `${branch.name} proposal content`, configurationId);

      await apiCall(options.apiUrl, auth, 'PATCH', `/branch-configurations/${configurationId}/invoice-automations`, {
        autoCreateDepositInvoice: branch.autoCreateDepositInvoice ?? false,
        autoSendDepositInvoice: branch.autoSendDepositInvoice ?? false,
      });
      action('branch-configurations', 'updated', `${branch.name} invoice automations`, configurationId);

      // Standard payment terms (fixed canonical list) per branch configuration.
      // Idempotent: reconcile against existing config terms via listAll, dedupe
      // by name. Resilient: per-term try/catch logs + continues.
      const existingPaymentTerms = await listAll(options.apiUrl, auth, 'payment-terms', { branchConfigurationId: String(configurationId) });
      const paymentTermNames = new Set(existingPaymentTerms.map((doc) => String(doc.name || '').trim().toLowerCase()));
      for (const term of DEFAULT_PAYMENT_TERMS) {
        if (paymentTermNames.has(term.name.trim().toLowerCase())) continue;
        try {
          const result = await apiCall(options.apiUrl, auth, 'POST', '/payment-terms', {
            name: term.name,
            daysUntilDue: term.daysUntilDue,
            isDefault: term.isDefault ?? false,
            branchConfigurationId: configurationId,
          });
          action('payment-terms', 'created', term.name, result.id);
        } catch (err) {
          step('branches', 'running', `skipped payment-term ${term.name} for ${branch.name}: ${err.message}`);
        }
      }
    }
    step('branches', 'done');

    // Vehicle-types/vehicles, equipment-types, and users are all branch-scoped
    // (or branch-referencing), so they require at least one deployed branch.
    const firstBranchId = Object.values(branchIdsByName)[0];
    if (firstBranchId) {
      // --- Vehicles ---------------------------------------------------------
      step('vehicles', 'running');
      const vehicleTemplates = org.resources.vehicleTemplates || [];
      const existingVehicleTypes = await listAll(options.apiUrl, auth, 'vehicle-types', { branch: String(firstBranchId) });
      const typeToId = {};
      for (const type of new Set(vehicleTemplates.map((t) => t.type))) {
        const slug = slugify(type);
        const existing = existingVehicleTypes.find((vt) => vt.slug === slug);
        if (existing) {
          typeToId[type] = existing.id;
          action('vehicle-types', 'untouched', existing.name, existing.id);
        } else {
          const created = await apiCall(options.apiUrl, auth, 'POST', '/vehicle-types', {
            branch: firstBranchId,
            name: humanize(type),
            slug,
          });
          typeToId[type] = created.id;
          action('vehicle-types', 'created', created.name, created.id);
        }
      }
      let vehicleCount = 0;
      for (let i = 0; i < vehicleTemplates.length; i++) {
        const t = vehicleTemplates[i];
        const name = `${t.make ?? ''} ${t.model ?? ''}`.trim() || humanize(t.type);
        try {
          const result = await apiCall(options.apiUrl, auth, 'POST', '/vehicles', {
            name,
            type: typeToId[t.type],
            branch: firstBranchId,
            licensePlate: `FLEET${String(i + 1).padStart(2, '0')}`,
            make: t.make,
            model: t.model,
            year: t.year,
          });
          action('vehicles', 'created', name, result.id);
          vehicleCount += 1;
        } catch (err) {
          step('vehicles', 'running', `skipped ${name}: ${err.message}`);
        }
      }
      step('vehicles', 'done', `${vehicleCount} vehicle(s)`);

      // --- Equipment --------------------------------------------------------
      step('equipment', 'running');
      const equipmentTypes = org.resources.equipmentTypes || [];
      const existingEquipmentTypes = await listAll(options.apiUrl, auth, 'equipment-types', { branch: String(firstBranchId) });
      for (const str of equipmentTypes) {
        const slug = slugify(str);
        const name = humanize(str);
        try {
          const existing = existingEquipmentTypes.find((et) => et.slug === slug);
          if (existing) {
            action('equipment-types', 'untouched', existing.name, existing.id);
          } else {
            const created = await apiCall(options.apiUrl, auth, 'POST', '/equipment-types', {
              branch: firstBranchId,
              name,
              slug,
            });
            action('equipment-types', 'created', created.name, created.id);
          }
        } catch (err) {
          step('equipment', 'running', `skipped ${name}: ${err.message}`);
        }
      }
      step('equipment', 'done');
    }

    // --- Users --------------------------------------------------------------
    step('users', 'running');
    const roles = await listAll(options.apiUrl, auth, 'roles', {});
    const roleByName = {};
    for (const role of roles) roleByName[String(role.name || '').toLowerCase()] = role.id;
    let userCount = 0;
    for (const user of org.users || []) {
      const roleId = roleByName[String(user.role).toLowerCase()];
      const branchIds = (user.branches || []).map((n) => branchIdsByName[n]).filter(Boolean);
      if (!roleId || branchIds.length === 0) {
        step('users', 'running', `skipped ${user.email}: unresolved role/branches`);
        continue;
      }
      // The API requires passwords >= 8 chars; the generator emits short ones
      // for short role names (e.g. "Ops123!" = 7). Pad to satisfy the rule.
      const password = (user.password || '').length >= 8
        ? user.password
        : (user.password || 'Password').padEnd(8, '0');
      try {
        const result = await apiCall(options.apiUrl, auth, 'POST', '/user-admins', {
          email: user.email,
          name: user.name,
          password,
          roleIds: [roleId],
          branchIds,
        });
        action('users', 'created', user.email, result.id);
        credentials.push({ email: user.email, password, role: user.role });
        userCount += 1;
      } catch (err) {
        step('users', 'running', `skipped ${user.email}: ${err.message}`);
      }
    }
    step('users', 'done', `${userCount} user(s)`);

    step('complete', 'done', `Upserted ${actions.length} records inside ${organization.name}`);
    return { success: true, log, actions, credentials, organizationId: orgId, actor: auth.user };
  } catch (err) {
    step('error', 'failed', err.message);
    return { success: false, log, actions, credentials, error: err.message };
  }
}
