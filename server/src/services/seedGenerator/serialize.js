const ROLE_EMAILS = {
  Admin: 'admin',
  'Ops Manager': 'ops',
  'Sales Admin': 'salesadmin',
  'Sales Member': 'salesmember',
  'Client Coordinator': 'coordinator',
  'Crew Leader': 'lead',
  'Crew Member': 'crew',
};

const ROLE_PASSWORDS = {
  Admin: 'Admin123!',
  'Ops Manager': 'Ops123!',
  'Sales Admin': 'SalesAdmin123!',
  'Sales Member': 'SalesMember123!',
  'Client Coordinator': 'Coordinator123!',
  'Crew Leader': 'Lead123!',
  'Crew Member': 'Crew123!',
};

const ROLE_DISPLAY_NAMES = {
  Admin: 'Admin',
  'Ops Manager': 'Operations Manager',
  'Sales Admin': 'Sales Manager',
  'Sales Member': 'Sales Consultant',
  'Client Coordinator': 'Client Coordinator',
  'Crew Leader': 'Lead Technician',
  'Crew Member': 'Technician',
};

const DEFAULT_MULTIPLIER_RANGES = [
  { name: '$0 - $999', minCost: 0, maxCost: 999.99, lowestMultiple: 1.8, highestMultiple: 2.2 },
  { name: '$1,000 - $4,999', minCost: 1000, maxCost: 4999.99, lowestMultiple: 1.6, highestMultiple: 2.0 },
  { name: '$5,000 - $9,999', minCost: 5000, maxCost: 9999.99, lowestMultiple: 1.5, highestMultiple: 1.9 },
  { name: '$10,000 - $49,999', minCost: 10000, maxCost: 49999.99, lowestMultiple: 1.4, highestMultiple: 1.8 },
  { name: '$50,000+', minCost: 50000, maxCost: null, lowestMultiple: 1.3, highestMultiple: 1.7 },
];

const DEFAULT_PAYMENT_METHODS = [
  { label: 'Financing', type: 'financing', icon: 'cake-slice', enabled: true, sortOrder: 0 },
  { label: 'Cash', type: 'cash', icon: 'dollar-sign', enabled: true, sortOrder: 1 },
  { label: 'Credit Card', type: 'credit_card', icon: 'credit-card', enabled: true, sortOrder: 2 },
  { label: 'Check', type: 'check', icon: 'banknote', enabled: true, sortOrder: 3 },
];

function buildUsers(input) {
  const allBranches = input.branches.map((b) => b.name);
  const users = [];

  for (const { role, count } of input.roleDistribution) {
    if (count <= 0) continue;
    const emailPrefix = ROLE_EMAILS[role] || role.toLowerCase().replace(/\s+/g, '');
    const password = ROLE_PASSWORDS[role] || 'Password123!';
    const displayName = ROLE_DISPLAY_NAMES[role] || role;

    for (let i = 0; i < count; i++) {
      const suffix = i === 0 ? '' : String(i + 1);
      const branches =
        role === 'Admin' || role === 'Sales Admin' || role === 'Client Coordinator'
          ? allBranches
          : [allBranches[i % allBranches.length]];

      users.push({
        email: `${emailPrefix}${suffix}@${input.domain}.com`,
        password,
        name: displayName + (suffix ? ` ${suffix}` : ''),
        role,
        branches,
      });
    }
  }

  return users;
}

const BRANCH_CONFIG_DEFAULTS = {
  baseHourlyRate: 38,
  averageWorkDayHours: 8,
  wasteFactor: 1.1,
  creditCardFee: 0.03,
  gasCost: 4.00,
  truckAverageMPG: 15,
  laborHoursLoadUnload: 1.0,
  subMultiplier: 1.5,
  cashFactor: 0.97,
  maxDiscount: 15,
  depositPercent: 25,
  maxDepositAmount: 3000,
  autoSendDepositInvoice: false,
  maxOpenEstimates: 500,
  minRetailPrice: 200,
  b2bMaxDiscount: 25,
  qualityControlVisitPrice: 125,
  bonusPoolPercentage: 8,
  bonusPayoutCutoff: 75,
  leaderboardColorPercentage: 20,
};

// NOTE on placeholders: the Menaia proposal system only interpolates the exact
// tokens {{ company_name }}, {{ client_first_name }}, {{ inspector_name }},
// {{ inspector_number }}, {{ date }} (note the spaces inside the braces). Any
// other token renders literally, so these defaults use only those.
const PROPOSAL_CONTENT_DEFAULTS = {
  about:
    'Thank you for choosing us to complete the scope of work outlined in the proposal below. We are passionate about our work, our team, and, above all, delivering the best possible experience for every client.\n\nTo make sure we exceed your expectations, we believe in full transparency — including how we operate, what to expect throughout the process, and typical timelines. Our process and what you can expect are outlined below.',
  disclaimer:
    'All prices and schedules are estimates and subject to change based on site conditions. Any unforeseen conditions discovered during work may require a written change order.',
  paymentTerms:
    'A deposit is required to reserve your project and submit it for scheduling. Subsequent payments are due for completed work as specified in the proposal, with the remaining balance collected prior to crew departure on the final day of work. Any additional services added outside the original scope are billed separately as they are completed.',
  insuranceClaims:
    'If this work is performed as part of an insurance claim, it remains the client\'s responsibility to ensure full payment. If a claim is denied for any reason and the work has been started or completed, the client is obligated to pay the full amount within seven (7) days of written notice of the denial or of completion, whichever occurs first.',
  termsAndConditions:
    'By approving this proposal, you authorize the company to enter the job site and perform the services identified in the scope of work, and you accept responsibility for full payment as set forth above.\n\nThe company will undertake commercially reasonable efforts to complete the scope of work in accordance with industry standards. Services are limited to those identified in this proposal, and any stated completion timeline is a good-faith estimate based on the conditions known at the time the proposal was prepared.\n\nWhere a warranty is indicated, the company warrants that the work will be performed in a good and workmanlike manner; warranty remedies are limited to re-performing the affected work or refunding the amount paid for that work. Any change to the agreed scope requires a written change order.\n\nThis agreement is governed by the laws of the state in which the work is performed. The client may cancel this transaction without penalty prior to midnight of the third (3rd) business day after the date of this agreement.',
  defaultProposalEmailSubject: 'Proposal from {{ company_name }} - {{ date }}',
  defaultProposalEmailBody:
    'Hi {{ client_first_name }},\n\nThank you for your interest in working with us. Attached is the proposed quote and contract, prepared based on the project details you\'ve provided.\n\nPlease feel free to reach out if you have any questions, would like to make adjustments, or need clarification on any part of the proposal.\n\nBest regards,\n{{ inspector_name }}\n{{ inspector_number }}',
};

function buildBranches(input, extracted, pricebookBranchConfig, proposalContent) {
  const financing = (extracted.financingTerms || []).length > 0
    ? extracted.financingTerms
    : [{ name: '0% for 12 Months', termMonths: 12, interestRate: 0, mostPopular: true }];

  // Merge: AI-generated values override defaults; extracted text fields come from crawl
  const cfg = { ...BRANCH_CONFIG_DEFAULTS, ...(pricebookBranchConfig || {}) };

  // AI-generated proposal content overrides hardcoded defaults. Drop empty
  // string values so a blank AI field falls back to the default rather than
  // publishing an empty proposal section.
  const cleanedPc = Object.fromEntries(
    Object.entries(proposalContent || {}).filter(([, v]) => String(v ?? '').trim() !== ''),
  );
  const pc = { ...PROPOSAL_CONTENT_DEFAULTS, ...cleanedPc };
  // When a section is still the generic default, swap "the company" for the real
  // company name so the boilerplate reads as this contractor's own.
  if (input.companyName) {
    if (pc.termsAndConditions === PROPOSAL_CONTENT_DEFAULTS.termsAndConditions) {
      pc.termsAndConditions = pc.termsAndConditions.replace('authorize the company to', `authorize ${input.companyName} to`);
    }
    if (pc.about === PROPOSAL_CONTENT_DEFAULTS.about) {
      pc.about = pc.about.replace('Thank you for choosing us', `Thank you for choosing ${input.companyName}`);
    }
  }

  return input.branches.map((b) => ({
    name: b.name,
    address: b.address,
    phone: extracted.phone || '',
    timezone: input.timezone,
    // Menaia's `about` is the proposal intro/welcome block (not a website-style
    // company blurb), so the AI/boilerplate version fits better than a raw crawl;
    // fall back to the crawled about only when no proposal `about` was produced.
    contractorLicense: extracted.contractorLicense || '',
    about: pc.about || extracted.about || '',
    aboutVideoUrl: '',
    financePartnerUrl: input.companyWebsite || '',
    disclaimer: pc.disclaimer,
    paymentTerms: pc.paymentTerms,
    insuranceClaims: pc.insuranceClaims,
    termsAndConditions: pc.termsAndConditions,
    defaultProposalEmailSubject: pc.defaultProposalEmailSubject,
    defaultProposalEmailBody: pc.defaultProposalEmailBody,
    baseHourlyRate: cfg.baseHourlyRate,
    averageWorkDayHours: cfg.averageWorkDayHours,
    wasteFactor: cfg.wasteFactor,
    creditCardFee: cfg.creditCardFee,
    gasCost: cfg.gasCost,
    truckAverageMPG: cfg.truckAverageMPG,
    laborHoursLoadUnload: cfg.laborHoursLoadUnload,
    subMultiplier: cfg.subMultiplier,
    cashFactor: cfg.cashFactor,
    maxDiscount: cfg.maxDiscount,
    depositPercent: cfg.depositPercent,
    maxDepositAmount: cfg.maxDepositAmount,
    autoSendDepositInvoice: false,
    maxOpenEstimates: cfg.maxOpenEstimates,
    minRetailPrice: cfg.minRetailPrice,
    b2bMaxDiscount: cfg.b2bMaxDiscount,
    qualityControlVisitPrice: cfg.qualityControlVisitPrice,
    bonusPoolPercentage: cfg.bonusPoolPercentage,
    bonusPayoutCutoff: cfg.bonusPayoutCutoff,
    leaderboardColorPercentage: cfg.leaderboardColorPercentage,
    branchPaymentMethods: DEFAULT_PAYMENT_METHODS,
    branchFinancingTerms: financing,
  }));
}

function buildCategories(pricebook) {
  const cats = pricebook.categories.map((cat) => ({
    name: cat.name,
    title: cat.title || cat.name,
    factorNames: cat.factorNames || [],
    items: cat.items.map((item) => ({
      name: item.name,
      // Single description field: the rich customer-facing text. `notes` is the
      // legacy field name; prefer it if an older pricebook still supplies it.
      itemInfo: item.itemInfo || item.notes || '',
      unit: item.unit,
      materialCost: item.materialCost,
      laborHours: item.laborHours,
      multiplierOverride: item.multiplierOverride ?? null,
      subItem: false,
      requiresInfo: item.requiresInfo ?? false,
      factorNames: item.factorNames || [],
      additionalCostNames: item.additionalCostNames || [],
      imageUrl: item.imageUrl || null,
      imageSource: item.imageSource || null,
    })),
  }));

  if (pricebook.subcontractedItems && pricebook.subcontractedItems.length > 0) {
    cats.push({
      name: 'Subcontracted Services',
      title: 'Subcontracted Services',
      factorNames: [],
      items: pricebook.subcontractedItems.map((item) => ({
        name: item.name,
        itemInfo: item.itemInfo || item.notes || '',
        unit: item.unit,
        materialCost: item.materialCost,
        laborHours: 0,
        multiplierOverride: item.multiplierOverride ?? null,
        subItem: true,
        requiresInfo: item.requiresInfo ?? false,
        factorNames: item.factorNames || [],
        additionalCostNames: item.additionalCostNames || [],
        imageUrl: item.imageUrl || null,
        imageSource: item.imageSource || null,
      })),
    });
  }

  return cats;
}

// The LLM occasionally tags items/categories/work-areas with a factor or
// additional-cost name it never actually defined (or a renamed one), which makes
// the strict deploy validation throw. Drop any reference that doesn't resolve to
// a defined resource so the org is always internally consistent.
function pruneDanglingReferences(categories, workAreas, factors, additionalCosts) {
  const factorNames = new Set((factors || []).map((f) => f.name));
  const costNames = new Set((additionalCosts || []).map((c) => c.name));
  const categoryNames = new Set(categories.map((c) => c.name));

  for (const cat of categories) {
    cat.factorNames = (cat.factorNames || []).filter((n) => factorNames.has(n));
    for (const item of cat.items) {
      item.factorNames = (item.factorNames || []).filter((n) => factorNames.has(n));
      item.additionalCostNames = (item.additionalCostNames || []).filter((n) => costNames.has(n));
    }
  }
  for (const wa of workAreas) {
    wa.categories = (wa.categories || []).filter((n) => categoryNames.has(n));
    wa.factorNames = (wa.factorNames || []).filter((n) => factorNames.has(n));
  }
}

function buildWorkAreas(pricebook) {
  const areas = pricebook.workAreas.map((w) => ({
    name: w.name,
    categories: w.categories || [],
    factorNames: w.factorNames || [],
  }));

  if (pricebook.subcontractedItems && pricebook.subcontractedItems.length > 0) {
    areas.push({ name: 'Subcontracted Services', categories: ['Subcontracted Services'], factorNames: [] });
  }

  return areas;
}

export function serializeOrganization(input, extracted, pricebook) {
  const totalItems =
    pricebook.categories.reduce((s, c) => s + c.items.length, 0) +
    (pricebook.subcontractedItems?.length || 0);

  const categories = buildCategories(pricebook);
  const workAreas = buildWorkAreas(pricebook);
  pruneDanglingReferences(categories, workAreas, pricebook.factors, pricebook.additionalCosts);

  return {
    slug: input.slug,
    name: input.companyName,
    domain: input.domain,
    timezone: input.timezone,
    industry: extracted.industry || '',
    region: extracted.region || '',
    source: input.companyWebsite ? 'real_client' : 'demo',
    websiteUrl: input.companyWebsite || '',
    status: 'draft',
    createdAt: new Date().toISOString(),
    stats: {
      branches: input.branches.length,
      categories: categories.length,
      items: totalItems,
      workAreas: workAreas.length,
      factors: pricebook.factors.length,
    },
    branches: buildBranches(input, extracted, pricebook.branchConfig, pricebook.proposalContent),
    users: buildUsers(input),
    resources: {
      factors: pricebook.factors.map((f) => ({
        name: f.name,
        factor: f.factor,
        appliesTo: f.appliesTo,
        alwaysEnabled: f.alwaysEnabled,
      })),
      additionalCosts: (pricebook.additionalCosts || []).map((c) => ({
        name: c.name,
        cost: c.cost,
        appliesTo: c.appliesTo,
      })),
      multiplierRanges: DEFAULT_MULTIPLIER_RANGES,
      categories,
      workAreas,
      vehicleTemplates: (pricebook.vehicleTemplates || []).map((v) => ({
        type: v.type,
        make: v.make,
        model: v.model,
        year: v.year,
      })),
      equipmentTypes: pricebook.equipmentTypes || [],
    },
  };
}
