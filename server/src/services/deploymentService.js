import env from '../config/env.js';
import logger from '../utils/logger.js';

const PAGE_LIMIT = 100;

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
    deferred: {
      users: org.users?.length || 0,
      vehicles: org.resources.vehicleTemplates?.length || 0,
      equipmentTypes: org.resources.equipmentTypes?.length || 0,
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
 * NOTE: several legacy branch-config fields are NOT in Create/UpdateBranchSchema
 * and are intentionally omitted — see the TODO(menaia-gap) block below.
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
    // TODO(menaia-gap): the following branch-config fields the deployment used to
    // write are NOT in Create/UpdateBranchSchema (packages/common/src/schemas/branch.ts)
    // and have no /v1 endpoint, so they are dropped:
    //   autoCreateDepositInvoice, autoSendDepositInvoice,
    //   defaultProposalEmailSubject, defaultProposalEmailBody, financePartnerUrl,
    //   contractorLicense, about, aboutVideoUrl, disclaimer, paymentTerms,
    //   insuranceClaims, termsAndConditions, financeFactors (3/6/12),
    //   and the config `name` (server names the configuration).
  };
}

export async function deployOrg(org, options, onStep) {
  const log = [];
  const actions = [];
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
      itemInfo: item.itemInfo || item.notes || '',
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
    }
    step('branches', 'done');
    step('complete', 'done', `Upserted ${actions.length} records inside ${organization.name}`);
    return { success: true, log, actions, organizationId: orgId, actor: auth.user };
  } catch (err) {
    step('error', 'failed', err.message);
    return { success: false, log, actions, error: err.message };
  }
}
