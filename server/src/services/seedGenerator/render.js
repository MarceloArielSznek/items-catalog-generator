function toVarName(slug) {
  return (
    slug
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      .replace(/^./, (c) => c.toLowerCase()) + 'Organization'
  );
}

function indent(text, level) {
  const pad = '  '.repeat(level);
  return text
    .split('\n')
    .map((line) => (line.trim() ? pad + line : ''))
    .join('\n');
}

function stringLiteral(val) {
  return `'${String(val).replace(/'/g, "\\'")}'`;
}

function renderBranchConfig(extracted, input) {
  const financingTerms = extracted.financingTerms
    .map(
      (t) => `    {
      name: ${stringLiteral(t.name)},
      termMonths: ${t.termMonths},
      interestRate: ${t.interestRate},
      mostPopular: ${t.mostPopular},
    }`,
    )
    .join(',\n');

  return `const branchConfig: Omit<
  BranchConfigSeedData,
  'name' | 'address'
> = {
  phone: ${stringLiteral(extracted.phone)},
  contractorLicense: ${stringLiteral(extracted.contractorLicense)},
  about:
    ${stringLiteral(extracted.about)},
  aboutVideoUrl: '',
  financePartnerUrl: ${stringLiteral(input.companyWebsite)},
  branchPaymentMethods: [
    { label: 'Financing', type: 'financing', icon: 'cake-slice', enabled: true, sortOrder: 0 },
    { label: 'Cash', type: 'cash', icon: 'dollar-sign', enabled: true, sortOrder: 1 },
    { label: 'Credit Card', type: 'credit_card', icon: 'credit-card', enabled: true, sortOrder: 2 },
    { label: 'Check', type: 'check', icon: 'banknote', enabled: true, sortOrder: 3 },
  ],
  branchFinancingTerms: [
${financingTerms},
  ],
  disclaimer:
    'All prices and schedules are estimates and subject to change based on site conditions. Any unforeseen conditions discovered during work may require a change order.',
  paymentTerms:
    'Deposit is required to reserve your project. Remaining balance is due upon completion unless otherwise agreed in writing.',
  insuranceClaims:
    'If this work is part of an insurance claim, customer is responsible for communicating with their carrier and providing claim documentation as needed.',
  termsAndConditions:
    'By approving this proposal, you authorize ${input.companyName} to perform the described scope of work. Warranty details and full terms are available upon request.',
  timezone: ${stringLiteral(input.timezone)},
  baseHourlyRate: '34',
  averageWorkDayHours: '8',
  wasteFactor: '1.1',
  creditCardFee: '0.03',
  gasCost: '3.95',
  truckAverageMPG: '15',
  laborHoursLoadUnload: '1.5',
  subMultiplier: '1.5',
  cashFactor: '0.95',
  maxDiscount: '20',
  depositPercent: '10',
  maxDepositAmount: '5000',
  autoSendDepositInvoice: 'false',
  maxOpenEstimates: '1000',
  minRetailPrice: '3500',
  b2bMaxDiscount: '30',
  qualityControlVisitPrice: '150',
  bonusPoolPercentage: '0.10',
  bonusPayoutCutoff: '80',
  leaderboardColorPercentage: '25',
  financeFactors_3: '1.05',
  financeFactors_6: '1.10',
  financeFactors_12: '1.15',
};`;
}

function renderBranches(input) {
  return input.branches
    .map(
      (b) => `    {
      name: ${stringLiteral(b.name)},
      configuration: {
        ...branchConfig,
        name: ${stringLiteral(b.name + ' Configuration')},
        address: ${stringLiteral(b.address)},${b.latitude ? `\n        latitude: ${b.latitude},` : ''}${b.longitude ? `\n        longitude: ${b.longitude},` : ''}
      },
    }`,
    )
    .join(',\n');
}

function renderUsers(input) {
  const roleEmails = {
    Admin: 'admin',
    'Ops Manager': 'ops',
    'Sales Admin': 'salesadmin',
    'Sales Member': 'salesmember',
    'Client Coordinator': 'coordinator',
    'Crew Leader': 'lead',
    'Crew Member': 'crew',
  };

  const rolePasswords = {
    Admin: 'Admin123!',
    'Ops Manager': 'Ops123!',
    'Sales Admin': 'SalesAdmin123!',
    'Sales Member': 'SalesMember123!',
    'Client Coordinator': 'Coordinator123!',
    'Crew Leader': 'Lead123!',
    'Crew Member': 'Crew123!',
  };

  const roleNames = {
    Admin: `${input.companyName} Admin`,
    'Ops Manager': 'Operations Manager',
    'Sales Admin': 'Sales Manager',
    'Sales Member': 'Sales Consultant',
    'Client Coordinator': 'Client Coordinator',
    'Crew Leader': 'Lead Technician',
    'Crew Member': 'Technician',
  };

  const allBranches = input.branches.map((b) => b.name);
  const users = [];

  for (const { role, count } of input.roleDistribution) {
    if (count <= 0) continue;
    const emailPrefix = roleEmails[role] || role.toLowerCase().replace(/\s+/g, '');
    const password = rolePasswords[role] || 'Password123!';
    const displayName = roleNames[role] || role;

    for (let i = 0; i < count; i++) {
      const suffix = i === 0 ? '' : `${i + 1}`;
      const email = `${emailPrefix}${suffix}@${input.domain}.com`;
      const branches =
        role === 'Admin' || role === 'Sales Admin' || role === 'Client Coordinator'
          ? allBranches
          : [allBranches[i % allBranches.length]];

      users.push(`    {
      email: ${stringLiteral(email)},
      password: ${stringLiteral(password)},
      name: ${stringLiteral(displayName + (suffix ? ` ${suffix}` : ''))},
      role: ${stringLiteral(role)} as RoleName,
      branches: [${branches.map(stringLiteral).join(', ')}],
    }`);
    }
  }

  return users.join(',\n');
}

function renderRandomUsers(input) {
  const distribution = input.roleDistribution
    .filter((r) => r.count > 0)
    .map((r) => `      { role: ${stringLiteral(r.role)} as RoleName, weight: ${r.count} }`)
    .join(',\n');

  return `  randomUsers: {
    percentage: 100,
    blockedPercentage: 4,
    roleDistribution: [
${distribution},
    ],
    branchAssignment: 'distribute' as const,
  }`;
}

function renderCategories(pricebook) {
  const categories = pricebook.categories.map((cat) => {
    const items = cat.items
      .map(
        (item) =>
          `          { name: ${stringLiteral(item.name)}, itemInfo: ${stringLiteral(item.itemInfo || '')}, unit: ${stringLiteral(item.unit)} as ItemUnit, materialCost: ${item.materialCost}, laborHours: ${item.laborHours} }`,
      )
      .join(',\n');
    return `      {
        name: ${stringLiteral(cat.name)},
        items: [
${items},
        ],
      }`;
  });

  if (pricebook.subcontractedItems.length > 0) {
    const subItems = pricebook.subcontractedItems
      .map(
        (item) =>
          `        { name: ${stringLiteral(item.name)}, itemInfo: ${stringLiteral(item.itemInfo || '')}, unit: ${stringLiteral(item.unit)} as ItemUnit, materialCost: ${item.materialCost} }`,
      )
      .join(',\n');
    categories.push(`      createSubcontractedServicesCategory([
${subItems},
      ])`);
  }

  return categories.join(',\n');
}

function renderFactors(pricebook) {
  return pricebook.factors
    .map(
      (f) => `      {
        name: ${stringLiteral(f.name)},
        factor: ${f.factor},
        appliesTo: ${stringLiteral(f.appliesTo)},
        alwaysEnabled: ${f.alwaysEnabled},
      }`,
    )
    .join(',\n');
}

function renderAdditionalCosts(pricebook) {
  return pricebook.additionalCosts
    .map(
      (c) =>
        `      { name: ${stringLiteral(c.name)}, cost: ${c.cost}, appliesTo: ${stringLiteral(c.appliesTo)} }`,
    )
    .join(',\n');
}

function renderMultiplierRanges() {
  return `      {
        name: '$0 - $999',
        minCost: 0,
        maxCost: 999.99,
        lowestMultiple: 1.8,
        highestMultiple: 2.2,
      },
      {
        name: '$1,000 - $4,999',
        minCost: 1000,
        maxCost: 4999.99,
        lowestMultiple: 1.6,
        highestMultiple: 2.0,
      },
      {
        name: '$5,000 - $9,999',
        minCost: 5000,
        maxCost: 9999.99,
        lowestMultiple: 1.5,
        highestMultiple: 1.9,
      },
      {
        name: '$10,000 - $49,999',
        minCost: 10000,
        maxCost: 49999.99,
        lowestMultiple: 1.4,
        highestMultiple: 1.8,
      },
      {
        name: '$50,000+',
        minCost: 50000,
        maxCost: null,
        lowestMultiple: 1.3,
        highestMultiple: 1.7,
      }`;
}

function renderWorkAreas(pricebook) {
  const areas = pricebook.workAreas
    .map((w) => {
      const cats = (w.categories ?? []).map(stringLiteral).join(', ');
      return `      { name: ${stringLiteral(w.name)}, categories: [${cats}] }`;
    })
    .join(',\n');

  const hasSub = pricebook.subcontractedItems.length > 0;
  return hasSub ? `${areas},\n      createSubcontractedServicesWorkArea()` : areas;
}

function renderVehicles(pricebook) {
  return pricebook.vehicleTemplates
    .map(
      (v) =>
        `      { type: ${stringLiteral(v.type)}, make: ${stringLiteral(v.make)}, model: ${stringLiteral(v.model)}, year: ${v.year} }`,
    )
    .join(',\n');
}

function renderEquipment(pricebook) {
  return pricebook.equipmentTypes.map((e) => `      ${stringLiteral(e)}`).join(',\n');
}

export function renderOrganizationFile(input, extracted, pricebook) {
  const varName = toVarName(input.slug);

  return `import type { OrganizationSeedData, BranchConfigSeedData, RoleName, ItemUnit } from '../seed-data';
import { createSubcontractedServicesCategory, createSubcontractedServicesWorkArea } from '../seed-data';

${renderBranchConfig(extracted, input)}

export const ${varName}: OrganizationSeedData = {
  name: ${stringLiteral(input.companyName)},
  slug: ${stringLiteral(input.slug)},
  domain: ${stringLiteral(input.domain)},
  timezone: ${stringLiteral(input.timezone)},
${renderRandomUsers(input)},
  branches: [
${renderBranches(input)},
  ],
  users: [
${renderUsers(input)},
  ],
  resources: {
    factors: [
${renderFactors(pricebook)},
    ],
    additionalCosts: [
${renderAdditionalCosts(pricebook)},
    ],
    multiplierRanges: [
${renderMultiplierRanges()},
    ],
    categories: [
${renderCategories(pricebook)},
    ],
    workAreas: [
${renderWorkAreas(pricebook)},
    ],
    vehicleTemplates: [
${renderVehicles(pricebook)}${pricebook.vehicleTemplates.length > 0 ? ',' : ''}
    ],
    equipmentTypes: [
${renderEquipment(pricebook)}${pricebook.equipmentTypes.length > 0 ? ',' : ''}
    ],
  },
};
`;
}
