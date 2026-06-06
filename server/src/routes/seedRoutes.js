import { Router } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import env from '../config/env.js';
import { crawlWebsite } from '../services/seedGenerator/crawl.js';
import { extractWebsiteData } from '../services/seedGenerator/extract.js';
import { buildDemoSource } from '../services/seedGenerator/mergeDemo.js';
import { generatePricebook } from '../services/seedGenerator/research.js';
import { serializeOrganization } from '../services/seedGenerator/serialize.js';
import { generateSourceLedger } from '../services/seedGenerator/ledger.js';
import { parsePricebookXlsx } from '../services/seedGenerator/parseXlsx.js';
import { saveOrg } from '../services/orgStorageService.js';
import logger from '../utils/logger.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// POST /api/seed/crawl — crawl a website and return extracted company data
router.post('/crawl', async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'url is required' });

    try { new URL(url); } catch {
      return res.status(400).json({ success: false, error: 'Invalid URL' });
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ success: false, error: 'OPENAI_API_KEY not configured' });

    const openai = new OpenAI({ apiKey });

    logger.info(`Crawling website: ${url}`);
    const crawlResult = await crawlWebsite(url, 20, openai);
    logger.info(`Crawled ${crawlResult.pages.length} pages from ${url} (AI-guided: ${openai ? 'yes' : 'no'})`);

    const extracted = await extractWebsiteData(crawlResult.pages, openai);
    logger.info(`Extracted data for: ${extracted.companyName}`);

    res.json({
      success: true,
      data: {
        extracted,
        pagesCount: crawlResult.pages.length,
        slug: slugify(extracted.companyName),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/seed/demo/crawl — crawl N company sites of an industry (or one
// company), merge them into a synthetic catalog source, and invent a fake
// company identity. Returns the same `extracted` shape as /crawl so the review
// wizard + /generate path consume it unchanged (source becomes 'demo').
router.post('/demo/crawl', async (req, res, next) => {
  try {
    const { urls, branchCount } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ success: false, error: 'urls (non-empty array) is required' });
    }
    const branches = Math.max(1, Math.min(10, parseInt(branchCount, 10) || 1));
    const cleaned = [];
    for (const raw of urls) {
      const url = String(raw || '').trim();
      if (!url) continue;
      try { new URL(url); } catch {
        return res.status(400).json({ success: false, error: `Invalid URL: ${url}` });
      }
      cleaned.push(url);
    }
    if (cleaned.length === 0) return res.status(400).json({ success: false, error: 'No valid URLs provided' });

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ success: false, error: 'OPENAI_API_KEY not configured' });
    const openai = new OpenAI({ apiKey });

    logger.info(`Demo crawl: ${cleaned.length} site(s), ${branches} branch(es)`);
    const { extracted, identity, sourcesUsed, failures, serviceCount } = await buildDemoSource(cleaned, openai, { branchCount: branches });

    res.json({
      success: true,
      data: {
        extracted,
        identity,
        slug: slugify(extracted.companyName),
        sourcesUsed,
        failures,
        serviceCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/seed/generate-context — AI-write the optional "Additional Industry
// Context" hint shown in the catalog step, from the company info gathered so far.
// Returns a short paragraph the user can edit before generating the price book.
router.post('/generate-context', async (req, res, next) => {
  try {
    const { companyName, industry, region, about, website, isDemo } = req.body || {};
    if (!industry && !companyName && !about) {
      return res.status(400).json({ success: false, error: 'Provide at least an industry or company name' });
    }

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ success: false, error: 'OPENAI_API_KEY not configured' });
    const openai = new OpenAI({ apiKey });

    const facts = [
      companyName && `Company: ${companyName}`,
      industry && `Industry: ${industry}`,
      region && `Region / market: ${region}`,
      website && `Website: ${website}`,
      about && `About: ${about}`,
      isDemo && 'This is a synthetic demo organization.',
    ].filter(Boolean).join('\n');

    logger.info(`Generating industry context for ${companyName || industry}`);
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 220,
      temperature: 0.7,
      messages: [
        {
          role: 'user',
          content: `You write a short "industry context" hint that guides an AI price-book generator for a home-services/contractor company. Use the facts below to describe what services to emphasize, the typical scope, and the customer segment, so the generated catalog is accurate for THIS company.

${facts}

Write 2-4 concise sentences (no bullet points, no preamble, no headings). Focus on the specific services, scope, and customer type. Do not invent contact details or prices.`,
        },
      ],
    });

    const industryContext = response.choices?.[0]?.message?.content?.trim() || '';
    if (!industryContext) return res.status(502).json({ success: false, error: 'AI returned no content' });

    res.json({ success: true, data: { industryContext } });
  } catch (err) {
    next(err);
  }
});

// POST /api/seed/parse-xlsx — parse an uploaded pricebook Excel file
router.post('/parse-xlsx', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const { pricebook, warnings } = parsePricebookXlsx(req.file.buffer);

    const totalItems = pricebook.categories.reduce((sum, c) => sum + c.items.length, 0);
    logger.info(`Parsed xlsx: ${pricebook.workAreas.length} work areas, ${pricebook.categories.length} categories, ${totalItems} items`);

    res.json({
      success: true,
      data: {
        pricebook,
        warnings,
        stats: {
          workAreas: pricebook.workAreas.length,
          categories: pricebook.categories.length,
          items: totalItems,
          factors: pricebook.factors.length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/seed/generate — generate org JSON and save it
router.post('/generate', async (req, res, next) => {
  try {
    const { input, extracted, pricebook: uploadedPricebook } = req.body;

    if (!input || !extracted) {
      return res.status(400).json({ success: false, error: 'input and extracted are required' });
    }

    let pricebook;

    if (uploadedPricebook) {
      logger.info(`Using uploaded pricebook for: ${input.companyName}`);
      pricebook = uploadedPricebook;
    } else {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ success: false, error: 'OPENAI_API_KEY not configured' });

      const openai = new OpenAI({ apiKey });
      logger.info(`Generating pricebook for: ${input.companyName}`);

      pricebook = await generatePricebook(
        {
          services: extracted.services,
          industry: extracted.industry,
          region: extracted.region,
          companyName: input.companyName,
          companyAbout: extracted.about,
          totalItems: input.targets?.totalItems,
          workAreaCount: input.targets?.workAreas,
          categoryCount: input.targets?.itemCategories,
          itemsPerCategory: input.targets?.itemsPerCategory,
          industryContext: input.industryContext,
          synthesized: false,
        },
        openai,
      );
    }

    const totalItems = pricebook.categories.reduce((sum, c) => sum + c.items.length, 0);
    logger.info(`Pricebook ready: ${pricebook.categories.length} categories, ${totalItems} items`);

    const org = serializeOrganization(input, extracted, pricebook);
    const ledger = generateSourceLedger(extracted, pricebook, 0);
    saveOrg(org);
    logger.info(`Saved org JSON: ${org.slug}`);

    res.json({
      success: true,
      data: {
        org,
        ledger,
        slug: org.slug,
        stats: org.stats,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
