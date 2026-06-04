import env from '../config/env.js';
import logger from '../utils/logger.js';

const PAGE_LIMIT = 100;

function apiBaseUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
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

function buildSupabaseCookie(supabaseUrl, session) {
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const payload = encodeURIComponent(JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type ?? 'bearer',
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    user: session.user,
  }));
  const chunks = [];
  for (let index = 0; index < payload.length; index += 3800) {
    chunks.push(`${cookieName}.${chunks.length}=${payload.slice(index, index + 3800)}`);
  }
  return chunks.join('; ');
}

async function authenticate(credentials) {
  const supabaseUrl = (credentials.supabaseUrl || env.SUPABASE_URL || '').replace(/\/+$/, '');
  const publishableKey = credentials.publishableKey || env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) throw new Error('Supabase URL and publishable key are required');
  if (!credentials.email || !credentials.password) throw new Error('Admin email and password are required');

  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
    },
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  const session = await response.json().catch(() => null);
  if (!response.ok || !session?.access_token) {
    throw new Error(`Admin sign-in failed: ${session?.error_description || session?.message || response.statusText}`);
  }

  const cookie = buildSupabaseCookie(supabaseUrl, session);
  return {
    headers: {
      'Content-Type': 'application/json',
      Cookie: [credentials.vercelToken || env.VERCEL_TOKEN ? `_vercel_jwt=${credentials.vercelToken || env.VERCEL_TOKEN}` : '', cookie]
        .filter(Boolean)
        .join('; '),
    },
    user: { id: session.user?.id || null, email: session.user?.email || credentials.email },
  };
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
    throw new Error(`${method} /api${path} -> ${response.status}: ${message}`);
  }
  return result;
}

async function listAll(baseUrl, auth, collection, params = {}) {
  const docs = [];
  let page = 1;
  let hasNextPage = true;
  while (hasNextPage) {
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT), page: String(page), depth: '0', ...params });
    const result = await apiCall(baseUrl, auth, 'GET', `/${collection}?${query}`);
    docs.push(...(result?.docs || []));
    hasNextPage = Boolean(result?.hasNextPage);
    page++;
  }
  return docs;
}

async function resolveScopedOrganization(baseUrl, auth, expectedOrganizationId = null) {
  const organizations = await listAll(baseUrl, auth, 'organizations');
  if (organizations.length !== 1) {
    throw new Error(`Scoped admin must have access to exactly one organization; found ${organizations.length}`);
  }
  const organization = organizations[0];
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

async function loadExisting(baseUrl, auth, organizationId) {
  const scoped = { 'where[organization][equals]': String(organizationId) };
  const [factors, additionalCosts, multiplierRanges, items, categories, workAreas, branches] = await Promise.all([
    listAll(baseUrl, auth, 'factors', scoped),
    listAll(baseUrl, auth, 'additional-costs', scoped),
    listAll(baseUrl, auth, 'multiplier-ranges', scoped),
    listAll(baseUrl, auth, 'items', scoped),
    listAll(baseUrl, auth, 'item-categories', scoped),
    listAll(baseUrl, auth, 'work-areas', scoped),
    listAll(baseUrl, auth, 'branches', scoped),
  ]);
  return { factors, additionalCosts, multiplierRanges, items, categories, workAreas, branches };
}

export async function preflightOrgDeployment(org, options) {
  validateOrgForDeployment(org);
  const auth = await authenticate(options.credentials);
  const organization = await resolveScopedOrganization(options.apiUrl, auth);
  const existing = await loadExisting(options.apiUrl, auth, organization.id);
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
    const body = bodyFn(item);
    const result = match
      ? await apiCall(baseUrl, auth, 'PATCH', `/${collection}/${match.id}`, body)
      : await apiCall(baseUrl, auth, 'POST', `/${collection}`, body);
    ids[item.name] = result.id;
    onAction?.(match ? 'updated' : 'created', item.name, result.id);
  }
  return ids;
}

function branchBaseConstants(branch) {
  return {
    baseHourlyRate: branch.baseHourlyRate,
    averageWorkDayHours: branch.averageWorkDayHours,
    wasteFactor: branch.wasteFactor,
    creditCardFee: branch.creditCardFee,
    gasCost: branch.gasCost,
    truckAverageMPG: branch.truckAverageMPG,
    laborHoursLoadUnload: branch.laborHoursLoadUnload,
    subMultiplier: branch.subMultiplier,
    cashFactor: branch.cashFactor,
    maxDiscount: branch.maxDiscount,
    depositPercent: branch.depositPercent,
    maxDepositAmount: branch.maxDepositAmount,
    autoCreateDepositInvoice: false,
    autoSendDepositInvoice: branch.autoSendDepositInvoice || false,
    address: branch.address || '',
    phone: branch.phone || '',
    defaultProposalEmailSubject: branch.defaultProposalEmailSubject || '',
    defaultProposalEmailBody: branch.defaultProposalEmailBody || '',
    financePartnerUrl: branch.financePartnerUrl || '',
    contractorLicense: branch.contractorLicense || '',
    about: branch.about || '',
    aboutVideoUrl: branch.aboutVideoUrl || '',
    disclaimer: branch.disclaimer || '',
    paymentTerms: branch.paymentTerms || '',
    insuranceClaims: branch.insuranceClaims || '',
    termsAndConditions: branch.termsAndConditions || '',
    minRetailPrice: branch.minRetailPrice,
    b2bMaxDiscount: branch.b2bMaxDiscount,
    qualityControlVisitPrice: branch.qualityControlVisitPrice,
    bonusPoolPercentage: Number(branch.bonusPoolPercentage || 0) / 100,
    bonusPayoutCutoff: branch.bonusPayoutCutoff,
    leaderboardColorPercentage: branch.leaderboardColorPercentage,
    maxOpenEstimates: branch.maxOpenEstimates,
    financeFactors: { 3: branch.financeFactors_3, 6: branch.financeFactors_6, 12: branch.financeFactors_12 },
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
    const auth = await authenticate(options.credentials);
    const organization = await resolveScopedOrganization(options.apiUrl, auth, options.expectedOrganizationId);
    const expectedConfirmation = `${organization.id}:${organization.slug || organization.domain || organization.name}`;
    if (options.confirmation !== expectedConfirmation) throw new Error(`Confirmation must exactly match "${expectedConfirmation}"`);
    validateOrgForDeployment(org);
    const existing = await loadExisting(options.apiUrl, auth, organization.id);
    const orgId = organization.id;
    step('preflight', 'done', `Scoped to organization ${organization.name} (${orgId})`);

    step('resources', 'running');
    const factorIds = await upsertNamed(options.apiUrl, auth, 'factors', org.resources.factors, existing.factors, (item) => ({ ...item, organization: orgId }), (op, name, id) => action('factors', op, name, id));
    const costIds = await upsertNamed(options.apiUrl, auth, 'additional-costs', org.resources.additionalCosts || [], existing.additionalCosts, (item) => ({ ...item, organization: orgId }), (op, name, id) => action('additional-costs', op, name, id));
    const rangeIds = await upsertNamed(options.apiUrl, auth, 'multiplier-ranges', org.resources.multiplierRanges, existing.multiplierRanges, (item) => ({ ...item, organization: orgId }), (op, name, id) => action('multiplier-ranges', op, name, id));
    step('resources', 'done');

    step('items', 'running');
    const itemIds = await upsertNamed(options.apiUrl, auth, 'items', flatItems(org), existing.items, (item) => ({
      name: item.name,
      itemInfo: item.itemInfo || item.notes || '',
      unit: item.unit,
      materialCost: item.materialCost,
      laborHours: item.laborHours,
      multiplierOverride: item.multiplierOverride ?? null,
      subItem: item.subItem || false,
      requiresInfo: item.requiresInfo || false,
      factors: resolveIds(item.factorNames, factorIds),
      additional_costs: resolveIds(item.additionalCostNames, costIds),
      organization: orgId,
    }), (op, name, id) => action('items', op, name, id));
    step('items', 'done');

    step('catalog', 'running');
    const categoryIds = await upsertNamed(options.apiUrl, auth, 'item-categories', org.resources.categories, existing.categories, (category) => ({
      name: category.name,
      items: category.items.map((item) => itemIds[item.name]).filter(Boolean),
      factors: resolveIds(category.factorNames, factorIds),
      organization: orgId,
    }), (op, name, id) => action('item-categories', op, name, id));
    const workAreaIds = await upsertNamed(options.apiUrl, auth, 'work-areas', org.resources.workAreas, existing.workAreas, (workArea) => ({
      name: workArea.name,
      item_categories: resolveIds(workArea.categories, categoryIds),
      factors: resolveIds(workArea.factorNames, factorIds),
      organization: orgId,
    }), (op, name, id) => action('work-areas', op, name, id));
    step('catalog', 'done');

    step('branches', 'running');
    const existingBranches = nameMap(existing.branches);
    for (const branch of org.branches) {
      const match = existingBranches.get(branch.name.trim().toLowerCase());
      const branchResult = match || await apiCall(options.apiUrl, auth, 'POST', '/branches', { name: branch.name, organization: orgId });
      action('branches', match ? 'updated' : 'created', branch.name, branchResult.id);
      const configurationId = branchResult.configuration?.id || branchResult.configuration;
      if (!configurationId) throw new Error(`Branch "${branch.name}" did not return a configuration`);
      await apiCall(options.apiUrl, auth, 'PATCH', `/branch-configurations/${configurationId}`, {
        name: `${branch.name} Configuration`,
        timezone: branch.timezone || org.timezone,
        baseConstants: branchBaseConstants(branch),
        multiplier_ranges: Object.values(rangeIds),
        work_areas: Object.values(workAreaIds),
        includeSubServicesInSalesPerformance: false,
        organization: orgId,
      });
      action('branch-configurations', 'updated', `${branch.name} Configuration`, configurationId);

      const scoped = { 'where[organization][equals]': String(orgId), 'where[branchConfiguration][equals]': String(configurationId) };
      const [terms, methods] = await Promise.all([
        listAll(options.apiUrl, auth, 'branch-financing-terms', scoped),
        listAll(options.apiUrl, auth, 'branch-payment-methods', scoped),
      ]);
      await upsertNamed(options.apiUrl, auth, 'branch-financing-terms', branch.branchFinancingTerms || [], terms, (term) => ({ ...term, branchConfiguration: configurationId, organization: orgId }), (op, name, id) => action('branch-financing-terms', op, name, id));
      const desiredMethods = (branch.branchPaymentMethods || []).map((method) => ({ ...method, name: method.label }));
      await upsertNamed(options.apiUrl, auth, 'branch-payment-methods', desiredMethods, methods.map((method) => ({ ...method, name: method.label })), (method) => ({
        label: method.label,
        type: method.type,
        icon: method.icon,
        enabled: method.enabled,
        sortOrder: method.sortOrder,
        branchConfiguration: configurationId,
        organization: orgId,
      }), (op, name, id) => action('branch-payment-methods', op, name, id));
    }
    step('branches', 'done');
    step('complete', 'done', `Upserted ${actions.length} records inside ${organization.name}`);
    return { success: true, log, actions, organizationId: orgId, actor: auth.user };
  } catch (err) {
    step('error', 'failed', err.message);
    return { success: false, log, actions, error: err.message };
  }
}
