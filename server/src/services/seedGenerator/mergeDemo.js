import { crawlWebsite } from './crawl.js';
import { extractWebsiteData } from './extract.js';
import logger from '../../utils/logger.js';

/**
 * Crawl + extract a list of company websites in parallel. One failure does not
 * sink the batch — failed sites are reported in `failures` and skipped.
 */
async function crawlAndExtractMany(urls, openai, maxPagesEach = 12) {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const crawl = await crawlWebsite(url, maxPagesEach, openai);
      const extracted = await extractWebsiteData(crawl.pages, openai);
      return { url, extracted, pagesCount: crawl.pages.length };
    }),
  );

  const extracts = [];
  const failures = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') extracts.push(r.value);
    else failures.push({ url: urls[i], error: r.reason?.message || String(r.reason) });
  });
  return { extracts, failures };
}

/** Most frequent non-empty value across a list (ties → first seen). */
function dominant(values) {
  const counts = new Map();
  for (const v of values) {
    const key = (v || '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) { best = key; bestCount = count; }
  }
  return best;
}

/** Case-insensitive de-duplicated union of all service strings. */
function mergeServices(extracts) {
  const seen = new Map(); // lowercased → original casing
  for (const { extracted } of extracts) {
    for (const svc of extracted.services || []) {
      const s = String(svc).trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (!seen.has(key)) seen.set(key, s);
    }
  }
  return [...seen.values()];
}

/**
 * Ask the LLM to invent a complete plausible-but-fictional company identity for
 * the industry: name, domain, about, a fake phone + contractor license, and
 * `branchCount` fake branches located in the region.
 * Returns { companyName, domain, about, phone, contractorLicense, branches }.
 */
async function generateFakeIdentity({ industry, region, services, branchCount = 1 }, openai) {
  const sample = services.slice(0, 25).join(', ');
  const n = Math.max(1, Math.min(10, branchCount));
  const system =
    'You invent realistic but fictional company identities for demo catalogs. ' +
    'Nothing may match a real company, phone, address, or license. Output ONLY JSON.';
  const user = [
    `Industry: ${industry || 'home services'}`,
    region ? `Region: ${region}` : '',
    sample ? `Representative services: ${sample}` : '',
    '',
    'Return JSON with this exact shape:',
    '{',
    '  "companyName": string,',
    '  "domain": string,',
    '  "about": string,',
    '  "phone": string,',
    '  "contractorLicense": string,',
    `  "branches": [ { "name": string, "address": string } ]  // exactly ${n} item(s)`,
    '}',
    '- companyName: a plausible, brandable, clearly fictional contractor name for this industry.',
    '- domain: a matching kebab-case slug usable as a subdomain (no spaces, no TLD).',
    '- about: 1-2 sentence company description in the voice of a real contractor site.',
    '- phone: a fake US phone in the 555 range, e.g. "(512) 555-0142".',
    '- contractorLicense: a plausible-looking but fake license for the region\'s state, e.g. "TX Lic. #FK-294817".',
    `- branches: exactly ${n} branch(es), each with a name (e.g. "Austin HQ", "North Branch") and a full street address located in the region. The first branch is the main office (HQ).`,
  ].filter(Boolean).join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.9,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content || '{}');
  const companyName = (parsed.companyName || '').trim() || `${industry || 'Demo'} Pros`;
  const domain = (parsed.domain || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  let branches = Array.isArray(parsed.branches)
    ? parsed.branches
        .map((b) => ({ name: String(b?.name || '').trim(), address: String(b?.address || '').trim() }))
        .filter((b) => b.name && b.address)
    : [];
  // Guarantee exactly n branches even if the model under/over-delivers.
  branches = branches.slice(0, n);
  while (branches.length < n) {
    branches.push({ name: `Branch ${branches.length + 1}`, address: `${100 + branches.length} Demo St, ${region || 'Demo City'}` });
  }

  return {
    companyName,
    domain,
    about: (parsed.about || '').trim(),
    phone: (parsed.phone || '').trim(),
    contractorLicense: (parsed.contractorLicense || '').trim(),
    branches,
  };
}

/**
 * Full demo pipeline: crawl N company sites, merge their extracted data into one
 * synthetic catalog source, and generate a fake company identity. The returned
 * `extracted` is shaped exactly like the single-site `/crawl` output, so the
 * existing review wizard + `/generate` path consume it unchanged.
 *
 * Works for 1 URL (company demo) or many (industry demo).
 */
export async function buildDemoSource(urls, openai, { branchCount = 1 } = {}) {
  const { extracts, failures } = await crawlAndExtractMany(urls, openai);
  if (extracts.length === 0) {
    throw new Error(`All ${urls.length} site(s) failed to crawl: ${failures.map((f) => f.error).join('; ')}`);
  }

  const industry = dominant(extracts.map((e) => e.extracted.industry)) || 'general';
  const region = dominant(extracts.map((e) => e.extracted.region));
  const services = mergeServices(extracts);
  logger.info(`Demo merge: ${extracts.length}/${urls.length} sites, ${services.length} unique services, industry "${industry}"`);

  const identity = await generateFakeIdentity({ industry, region, services, branchCount }, openai);
  logger.info(`Demo identity: "${identity.companyName}" (${identity.domain}), ${identity.branches.length} fake branch(es)`);

  // Shape identical to extractWebsiteData() output, but fully synthetic: fake
  // identity, fake phone/license, and fake branches in the region.
  const extracted = {
    companyName: identity.companyName,
    phone: identity.phone,
    contractorLicense: identity.contractorLicense,
    about: identity.about,
    services,
    branches: identity.branches,
    financingTerms: [
      { name: '0% for 12 Months', termMonths: 12, interestRate: 0, mostPopular: true },
    ],
    industry,
    region,
    warnings: [],
  };

  return {
    extracted,
    identity,
    sourcesUsed: extracts.map((e) => ({ url: e.url, pagesCount: e.pagesCount })),
    failures,
    serviceCount: services.length,
  };
}
