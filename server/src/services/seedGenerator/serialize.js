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

const PROPOSAL_CONTENT_DEFAULTS = {
  disclaimer:
    'All prices and schedules are estimates and subject to change based on site conditions. Any unforeseen conditions discovered during work may require a change order.',
  paymentTerms:
    'A deposit is required to reserve your project. The remaining balance is due upon completion unless otherwise agreed in writing.',
  insuranceClaims:
    'If this work is part of an insurance claim, the customer is responsible for communicating with their carrier and providing claim documentation as needed.',
  termsAndConditions:
    'By approving this proposal, you authorize the company to perform the described scope of work. Any changes to the agreed scope require a written change order. Warranty details and full terms are available upon request.',
  defaultProposalEmailSubject: 'Your Proposal from {{companyName}} — Ready to Review',
  defaultProposalEmailBody:
    'Hi {{clientFirstName}},\n\nThank you for the opportunity to work with you. Your proposal is ready for review.\n\nClick below to view your proposal, ask questions, and approve when you\'re ready:\n{{proposalLink}}\n\nIf you have any questions, feel free to reply to this email or give us a call. We look forward to working with you.\n\nBest regards,\n{{companyName}}',
};

function buildBranches(input, extracted, pricebookBranchConfig, proposalContent) {
  const financing = (extracted.financingTerms || []).length > 0
    ? extracted.financingTerms
    : [{ name: '0% for 12 Months', termMonths: 12, interestRate: 0, mostPopular: true }];

  // Merge: AI-generated values override defaults; extracted text fields come from crawl
  const cfg = { ...BRANCH_CONFIG_DEFAULTS, ...(pricebookBranchConfig || {}) };

  // AI-generated proposal content overrides hardcoded defaults
  const pc = { ...PROPOSAL_CONTENT_DEFAULTS, ...(proposalContent || {}) };
  // Inject company name into terms and conditions if it's still the generic version
  if (pc.termsAndConditions === PROPOSAL_CONTENT_DEFAULTS.termsAndConditions) {
    pc.termsAndConditions = `By approving this proposal, you authorize ${input.companyName} to perform the described scope of work. Any changes to the agreed scope require a written change order. Warranty details and full terms are available upon request.`;
  }

  return input.branches.map((b) => ({
    name: b.name,
    address: b.address,
    phone: extracted.phone || '',
    timezone: input.timezone,
    contractorLicense: extracted.contractorLicense || '',
    about: extracted.about || '',
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
      itemInfo: item.itemInfo || '',
      notes: item.notes || '',
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
        itemInfo: item.itemInfo || '',
        notes: item.notes || '',
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
