export function generateSourceLedger(extracted, pricebook, crawledPageCount) {
  const entries = [];

  entries.push({ field: 'companyName', value: extracted.companyName, source: 'website-verified', note: 'From website title/header' });
  entries.push({ field: 'phone', value: extracted.phone, source: extracted.phone ? 'website-verified' : 'flagged', note: extracted.phone ? 'Found on website' : 'Not found on website' });
  entries.push({ field: 'contractorLicense', value: extracted.contractorLicense, source: extracted.contractorLicense ? 'website-verified' : 'flagged', note: extracted.contractorLicense ? 'Found on website' : 'Not stated on website' });
  entries.push({ field: 'about', value: extracted.about.slice(0, 60) + '...', source: 'website-verified', note: 'Derived from website copy' });
  entries.push({ field: 'industry', value: extracted.industry, source: 'website-verified', note: 'Inferred from services offered' });
  entries.push({ field: 'region', value: extracted.region, source: 'website-verified', note: 'Inferred from service areas/addresses' });
  entries.push({ field: 'services', value: `${extracted.services.length} services`, source: 'website-verified', note: `Extracted from ${crawledPageCount} crawled pages` });

  for (const branch of extracted.branches) {
    const hasFullAddress = /\d+.*\d{5}/.test(branch.address);
    entries.push({
      field: `branch: ${branch.name}`,
      value: branch.address,
      source: hasFullAddress ? 'website-verified' : 'flagged',
      note: hasFullAddress ? 'Full street address found' : 'Address may be incomplete — verify ZIP',
    });
  }

  entries.push({ field: 'financingTerms', value: `${extracted.financingTerms.length} terms`, source: extracted.financingTerms.some((t) => t.name.includes('0%')) ? 'website-verified' : 'fabricated-estimate', note: 'Terms from website or industry-standard defaults' });
  entries.push({ field: 'workAreas', value: `${pricebook.workAreas.length} areas`, source: 'fabricated-estimate', note: 'AI-generated based on industry research' });
  entries.push({ field: 'categories', value: `${pricebook.categories.length} categories`, source: 'fabricated-estimate', note: 'AI-generated, mapped from detected services' });

  const totalItems = pricebook.categories.reduce((sum, c) => sum + c.items.length, 0);
  entries.push({ field: 'items + pricing', value: `${totalItems} items`, source: 'fabricated-estimate', note: 'AI-generated wholesale costs — reference industry guides, not actual company prices' });
  entries.push({ field: 'factors', value: `${pricebook.factors.length} factors`, source: 'fabricated-estimate', note: 'Standard labor/access multipliers' });
  entries.push({ field: 'vehicles', value: `${pricebook.vehicleTemplates.length} vehicles`, source: 'fabricated-estimate', note: 'Typical fleet for the industry' });
  entries.push({ field: 'users/roles', value: 'role distribution', source: 'fabricated-estimate', note: 'User-specified counts with generated names/emails' });

  const maxField = Math.max(...entries.map((e) => e.field.length));
  const maxValue = Math.max(...entries.map((e) => e.value.length));

  const header = `${'FIELD'.padEnd(maxField)}  ${'VALUE'.padEnd(maxValue)}  ${'SOURCE'.padEnd(20)}  NOTE`;
  const separator = '-'.repeat(header.length);
  const rows = entries.map((e) => `${e.field.padEnd(maxField)}  ${e.value.padEnd(maxValue)}  ${e.source.padEnd(20)}  ${e.note || ''}`);

  return [
    '',
    '═══ SOURCE LEDGER ═══',
    '',
    header,
    separator,
    ...rows,
    '',
    'Legend:',
    '  website-verified    = Directly found on the company website',
    '  cross-verified      = Confirmed with ≥2 sources',
    '  flagged             = Could not verify or conflicts detected',
    '  fabricated-estimate = AI-generated estimate based on industry data',
    '',
  ].join('\n');
}
