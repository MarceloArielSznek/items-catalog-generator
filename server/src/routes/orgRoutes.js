import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import sharp from 'sharp';
import OpenAI from 'openai';
import { listOrgs, getOrg, saveOrg, updateOrg, deleteOrg, updateDeploymentLog } from '../services/orgStorageService.js';
import { deployOrg, preflightOrgDeployment } from '../services/deploymentService.js';
import { downloadImage, findBestImage, findImageCandidates } from '../services/imageSearchService.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORGS_DIR = path.resolve(__dirname, '../generated-orgs');
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();

// ── Image helpers ─────────────────────────────────────────────────────────────

function mediaDir(slug) {
  return path.join(ORGS_DIR, 'media', slug);
}

function imageKey(categoryName, itemName) {
  const safe = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  return `${safe(categoryName)}__${safe(itemName)}`;
}

function imageFilePath(slug, key) {
  return path.join(mediaDir(slug), `${key}.jpg`);
}

function imageApiUrl(slug, key) {
  return `/api/orgs/${slug}/media/${key}.jpg`;
}

function deepUpdateItem(org, categoryName, itemName, patch) {
  const updated = JSON.parse(JSON.stringify(org));
  const cat = updated.resources.categories.find((c) => c.name === categoryName);
  if (!cat) return updated;
  const item = cat.items.find((i) => i.name === itemName);
  if (item) Object.assign(item, patch);
  return updated;
}

/**
 * Build a detailed, context-rich prompt for AI image generation.
 * Uses imageStyle (home + technician descriptions) to create visual continuity
 * across all images for the same org — same house, same technician look.
 */
function buildImagePrompt(itemName, categoryName, notes, industry, imageStyle = {}) {
  const { home, technician, styleNotes } = imageStyle || {};
  const combined = `${itemName} ${categoryName} ${notes || ''}`.toLowerCase();

  // ── Classify scene type from item/category/notes keywords ─────────────────
  const inAttic    = /attic/.test(combined);
  const inCrawl    = /crawl[\s-]?space|encapsulat|vapor\s*barrier/.test(combined);
  const isEquip    = /\b(unit|system|pump|furnace|ac\b|hvac|compressor|air\s*handler|coil|condenser)\b/.test(combined);
  const isInstall  = /\b(install|replac|retrofit|mount|hang|set\s*up|swap|change[\s-]?out)\b/.test(combined);
  const isInspect  = /\b(inspect|assess|test|diagnos|evaluat|audit|survey)\b/.test(combined);
  const isCleaning = /\b(clean|flush|purge|sanitize|wash|remov)\b/.test(combined);
  const isInsul    = /\b(insulat|blow|batts|r[\s-]?\d+|cellulose|fiberglass|spray\s*foam)\b/.test(combined);
  const isDuct     = /\b(duct|venting|register|diffuser|plenum)\b/.test(combined);

  // ── Scene opening ──────────────────────────────────────────────────────────
  let scene;
  if (inAttic && isInsul) {
    scene = `A technician is blowing or installing insulation inside a residential attic — ${itemName}`;
  } else if (inAttic) {
    scene = `A technician is working inside a residential attic — ${itemName}`;
  } else if (inCrawl) {
    scene = `A technician is working inside a residential crawl space — ${itemName}`;
  } else if (isInspect) {
    scene = `A technician carefully inspects and evaluates — ${itemName}`;
  } else if (isCleaning) {
    scene = `A technician performs a professional ${itemName} service`;
  } else if (isDuct) {
    scene = `A technician works on the ductwork system — ${itemName}`;
  } else if (isEquip || isInstall) {
    scene = `A technician actively installs ${itemName} at a residential property`;
  } else {
    scene = `A professional technician performing ${itemName}`;
  }

  // ── Property / setting ─────────────────────────────────────────────────────
  const property = home
    ? `Property: ${home}.`
    : `At a typical residential property${industry ? ` for a ${industry} contractor` : ''}.`;

  // ── Technician appearance ──────────────────────────────────────────────────
  const worker = technician
    ? `The technician: ${technician}.`
    : `A professional technician in clean work uniform and appropriate safety gear.`;

  // ── Service context from item notes ───────────────────────────────────────
  const serviceCtx = notes
    ? `Service scope: ${notes.replace(/\n+/g, ' ').trim().slice(0, 220)}.`
    : '';

  // ── Visual style / quality ─────────────────────────────────────────────────
  const quality = [
    styleNotes ? `Style: ${styleNotes}.` : 'Style: clean, bright, professional.',
    'Photorealistic photograph, natural lighting, sharp focus on the work.',
    'Real residential job site — not a staged studio look.',
    'No text, no logos, no watermarks, no price tags, no overlaid graphics.',
    'Composition shows the work in context — not just a tight closeup.',
  ].join(' ');

  return [scene, property, worker, serviceCtx, quality].filter(Boolean).join('\n');
}

async function generateImageBuffer(openai, prompt, model = 'gpt-image-1', quality = 'low') {
  const options = {
    model,
    prompt,
    n: 1,
    size: model === 'dall-e-3' ? '1024x1024' : '1536x1024',
    quality,
  };
  const imageRes = await openai.images.generate(options);
  const image = imageRes.data?.[0];
  if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');
  if (image?.url) {
    const fetchRes = await fetch(image.url);
    if (!fetchRes.ok) throw new Error(`Could not download generated image (${fetchRes.status})`);
    return Buffer.from(await fetchRes.arrayBuffer());
  }
  throw new Error('OpenAI returned no image data');
}

async function saveItemImage(slug, categoryName, itemName, inputBuffer, patch = {}) {
  const key = imageKey(categoryName, itemName);
  fs.mkdirSync(mediaDir(slug), { recursive: true });
  const buf = await sharp(inputBuffer).resize(1024, 768, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
  fs.writeFileSync(imageFilePath(slug, key), buf);

  const imageUrl = imageApiUrl(slug, key);
  const currentOrg = getOrg(slug);
  const updated = deepUpdateItem(currentOrg, categoryName, itemName, { imageUrl, ...patch });
  saveOrg(updated);
  return imageUrl;
}

// GET /api/orgs — list all generated orgs (summary only)
router.get('/', (_req, res) => {
  try {
    res.json({ success: true, data: listOrgs() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/orgs/:slug — get full org JSON
router.get('/:slug', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    res.json({ success: true, data: org });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs — save a generated org
router.post('/', (req, res) => {
  try {
    const { org } = req.body;
    if (!org?.slug) return res.status(400).json({ success: false, error: 'org.slug is required' });
    const saved = saveOrg(org);
    logger.info(`Saved org: ${org.slug}`);
    res.json({ success: true, data: saved });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/orgs/:slug — partial update (e.g. deployment credentials)
router.patch('/:slug', (req, res) => {
  try {
    const updated = updateOrg(req.params.slug, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Org not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/orgs/:slug
router.delete('/:slug', (req, res) => {
  try {
    const deleted = deleteOrg(req.params.slug);
    if (!deleted) return res.status(404).json({ success: false, error: 'Org not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/orgs/:slug/settings — update org info and/or branch config for all branches
router.patch('/:slug/settings', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const { orgInfo, branchConfig, financingTerms, proposalContent, imageStyle } = req.body;
    let updated = { ...org };

    if (orgInfo) {
      const { name, industry, region, timezone, websiteUrl } = orgInfo;
      if (name !== undefined) updated.name = name;
      if (industry !== undefined) updated.industry = industry;
      if (region !== undefined) updated.region = region;
      if (timezone !== undefined) updated.timezone = timezone;
      if (websiteUrl !== undefined) updated.websiteUrl = websiteUrl;
    }

    if (branchConfig) {
      updated.branches = updated.branches.map((b) => ({ ...b, ...branchConfig }));
    }

    if (financingTerms !== undefined) {
      updated.branches = updated.branches.map((b) => ({ ...b, branchFinancingTerms: financingTerms }));
    }

    if (proposalContent) {
      updated.branches = updated.branches.map((b) => ({ ...b, ...proposalContent }));
    }

    if (imageStyle !== undefined) {
      updated.imageStyle = imageStyle;
    }

    saveOrg(updated);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/orgs/:slug/resources — update catalog resources
router.patch('/:slug/resources', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const { categories, workAreas, factors, additionalCosts, multiplierRanges } = req.body;
    const resources = { ...org.resources };

    if (categories !== undefined) resources.categories = categories;
    if (workAreas !== undefined) resources.workAreas = workAreas;
    if (factors !== undefined) resources.factors = factors;
    if (additionalCosts !== undefined) resources.additionalCosts = additionalCosts;
    if (multiplierRanges !== undefined) resources.multiplierRanges = multiplierRanges;

    const totalItems = resources.categories.reduce((s, c) => s + (c.items?.length || 0), 0);
    const updated = {
      ...org,
      resources,
      stats: {
        ...org.stats,
        categories: resources.categories.length,
        items: totalItems,
        workAreas: resources.workAreas.length,
        factors: resources.factors.length,
      },
    };

    saveOrg(updated);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Item image management ─────────────────────────────────────────────────────

// GET /api/orgs/:slug/media/:filename — serve stored item image
router.get('/:slug/media/:filename', (req, res) => {
  const key = req.params.filename.replace(/\.jpg$/i, '');
  const p = imageFilePath(req.params.slug, key);
  if (!fs.existsSync(p)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  fs.createReadStream(p).pipe(res);
});

// POST /api/orgs/:slug/resources/item-image — upload image for a specific item
router.post('/:slug/resources/item-image', mediaUpload.single('image'), async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No image file' });

    const { categoryName, itemName } = req.body;
    if (!categoryName || !itemName) return res.status(400).json({ success: false, error: 'categoryName and itemName required' });

    const key = imageKey(categoryName, itemName);
    const dir = mediaDir(req.params.slug);
    fs.mkdirSync(dir, { recursive: true });

    const buf = await sharp(req.file.buffer).resize(1024, 768, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
    fs.writeFileSync(imageFilePath(req.params.slug, key), buf);

    const url = imageApiUrl(req.params.slug, key);
    const updated = deepUpdateItem(org, categoryName, itemName, { imageUrl: url });
    saveOrg(updated);
    logger.info(`Item image uploaded: ${req.params.slug} / ${itemName}`);
    res.json({ success: true, imageUrl: url });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/orgs/:slug/resources/item-image — remove image from an item
router.delete('/:slug/resources/item-image', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const { categoryName, itemName } = req.body;
    const key = imageKey(categoryName, itemName);
    try { fs.unlinkSync(imageFilePath(req.params.slug, key)); } catch { /* already gone */ }

    const updated = deepUpdateItem(org, categoryName, itemName, { imageUrl: null });
    saveOrg(updated);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/resources/item-image/generate — AI-generate image for one item
router.post('/:slug/resources/item-image/generate', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const { categoryName, itemName, notes } = req.body;
    if (!categoryName || !itemName) return res.status(400).json({ success: false, error: 'categoryName and itemName required' });

    if (!env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: 'OPENAI_API_KEY not configured' });
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

    logger.info(`Generating AI image: ${org.slug} / ${itemName}`);
    const prompt = buildImagePrompt(itemName, categoryName, notes, org.industry, org.imageStyle);
    const buf = await generateImageBuffer(openai, prompt, 'gpt-image-1', 'medium');
    const url = await saveItemImage(req.params.slug, categoryName, itemName, buf, { imageSource: 'ai-generated' });
    logger.info(`AI image saved: ${req.params.slug} / ${itemName}`);
    res.json({ success: true, imageUrl: url });
  } catch (err) {
    logger.error(`AI image generation failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/resources/item-image/edit — img2img: edit current image based on user feedback
router.post('/:slug/resources/item-image/edit', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    if (!env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: 'OPENAI_API_KEY not configured' });

    const { categoryName, itemName, feedback } = req.body;
    if (!categoryName || !itemName || !feedback?.trim()) {
      return res.status(400).json({ success: false, error: 'categoryName, itemName, and feedback are required' });
    }

    // Find the stored image file on disk
    const key = imageKey(categoryName, itemName);
    const imgPath = imageFilePath(req.params.slug, key);
    if (!fs.existsSync(imgPath)) {
      return res.status(400).json({ success: false, error: 'No stored image found for this item — generate one first' });
    }

    // Convert JPEG → PNG (gpt-image-1 edit requires PNG)
    const pngBuffer = await sharp(imgPath).png().toBuffer();

    // Build an edit prompt: feedback + full item/org context for quality
    const { home, technician, styleNotes } = org.imageStyle || {};
    const cat = org.resources.categories.find((c) => c.name === categoryName);
    const item = cat?.items.find((i) => i.name === itemName);
    const notes = item?.notes || item?.itemInfo || '';

    const editPrompt = [
      `Correct this specific issue: ${feedback.trim()}.`,
      `This is a professional catalog photo for the service "${itemName}" (${categoryName})${org.industry ? ` — ${org.industry} contractor` : ''}.`,
      notes ? `Service context: ${notes.slice(0, 150)}.` : '',
      technician ? `Keep the technician consistent: ${technician}.` : '',
      home ? `Keep the property setting: ${home}.` : '',
      styleNotes ? `Style: ${styleNotes}.` : 'Style: photorealistic, clean, professional.',
      'No text, no logos, no watermarks.',
    ].filter(Boolean).join('\n');

    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const { toFile } = await import('openai');

    const imageFile = await toFile(pngBuffer, `${key}.png`, { type: 'image/png' });

    const response = await openai.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt: editPrompt,
      n: 1,
      size: '1536x1024',
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error('No image returned from OpenAI');

    const inputBuffer = Buffer.from(b64, 'base64');
    const url = await saveItemImage(req.params.slug, categoryName, itemName, inputBuffer, {
      imageSource: 'ai:edit',
    });

    logger.info(`Image edited (img2img): ${req.params.slug} / ${itemName}`);
    res.json({ success: true, imageUrl: url });
  } catch (err) {
    logger.error(`Image edit failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/resources/item-image/candidates — find ranked web candidates for one item
router.post('/:slug/resources/item-image/candidates', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const { categoryName, itemName, count = 3, contextHint } = req.body;
    if (!categoryName || !itemName) {
      return res.status(400).json({ success: false, error: 'categoryName and itemName required' });
    }

    const industryContext = [contextHint, org.industry, org.region].filter(Boolean).join(' ');
    const candidates = await findImageCandidates(itemName, categoryName, industryContext, Math.min(count, 6));

    res.json({
      success: true,
      data: candidates.map((c) => ({
        url: c.url,
        thumbUrl: c.thumbUrl,
        domain: c.domain,
        score: parseFloat(c.totalScore?.toFixed(2) || 0),
      })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/resources/item-image/select — download a chosen URL and save as item image
router.post('/:slug/resources/item-image/select', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const { categoryName, itemName, imageUrl, thumbUrl } = req.body;
    if (!categoryName || !itemName || !imageUrl) {
      return res.status(400).json({ success: false, error: 'categoryName, itemName, and imageUrl required' });
    }

    const buffer = await downloadImage(imageUrl, thumbUrl);
    let domain = '';
    try { domain = new URL(imageUrl).hostname.replace('www.', ''); } catch { /* ignore */ }

    const url = await saveItemImage(req.params.slug, categoryName, itemName, buffer, {
      imageSource: `web:${domain}`,
      sourceUrl: imageUrl,
    });

    logger.info(`Web image selected: ${req.params.slug} / ${itemName} from ${domain}`);
    res.json({ success: true, imageUrl: url });
  } catch (err) {
    logger.error(`Web image select failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/resources/bulk-generate-images — SSE stream, queue AI generation or web selection by category
router.post('/:slug/resources/bulk-generate-images', async (req, res) => {
  const org = getOrg(req.params.slug);
  if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

  const { categoryName, mode = 'generate', model = 'gpt-image-1', quality = 'low', overwrite = false } = req.body;
  const cat = org.resources.categories.find((c) => c.name === categoryName);
  if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });

  if (mode === 'generate' && !env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: 'OPENAI_API_KEY not configured' });
  if (!['generate', 'web'].includes(mode)) return res.status(400).json({ success: false, error: 'mode must be generate or web' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const openai = mode === 'generate' ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
  const results = [];

  for (let i = 0; i < cat.items.length; i++) {
    const item = cat.items[i];
    if (item.imageUrl && !overwrite) {
      results.push({ itemName: item.name, imageUrl: item.imageUrl, success: true, skipped: true });
      send({ type: 'progress', item: item.name, index: i, total: cat.items.length, status: 'skipped', imageUrl: item.imageUrl });
      continue;
    }

    send({ type: 'progress', item: item.name, index: i, total: cat.items.length, status: mode === 'web' ? 'searching' : 'generating' });
    try {
      let inputBuffer;
      let imageSource;
      let sourceUrl = null;

      if (mode === 'web') {
        const selected = await findBestImage(item.name, categoryName, org.industry || org.region || '');
        sourceUrl = selected.url;
        inputBuffer = await downloadImage(selected.url, selected.thumbUrl);
        imageSource = `web:${selected.domain || 'unknown'}`;
      } else {
        const prompt = buildImagePrompt(item.name, categoryName, item.notes || item.itemInfo, org.industry, org.imageStyle);
        inputBuffer = await generateImageBuffer(openai, prompt, model, quality);
        imageSource = `ai:${model}`;
      }

      const url = await saveItemImage(req.params.slug, categoryName, item.name, inputBuffer, { imageSource, sourceUrl });
      results.push({ itemName: item.name, imageUrl: url, imageSource, sourceUrl, success: true });
      send({ type: 'progress', item: item.name, index: i, total: cat.items.length, status: 'done', imageUrl: url, imageSource });
    } catch (err) {
      results.push({ itemName: item.name, success: false, error: err.message });
      send({ type: 'progress', item: item.name, index: i, total: cat.items.length, status: 'error', error: err.message });
    }
  }

  send({ type: 'done', results });
  res.end();
});

// POST /api/orgs/:slug/image-style/suggest — GPT-4o-mini generates visual style defaults
router.post('/:slug/image-style/suggest', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    if (!env.OPENAI_API_KEY) return res.status(500).json({ success: false, error: 'OPENAI_API_KEY not configured' });

    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

    const systemPrompt = `You generate visual style guidelines for home services contractor image catalogs.
Output ONLY valid JSON with exactly these three keys:
- home: A vivid, specific 2-sentence description of a residential property typical for this company's market. Include architectural style, exterior materials, era, surroundings, and any details that make it visually distinct and consistent.
- technician: A 1-sentence description of the technician who appears in service photos. Specify gender-neutral or specific appearance, uniform color, any equipment/gear. Avoid face descriptions.
- styleNotes: A short note (1 sentence) about lighting, mood, and visual tone that fits this trade.`;

    const userPrompt = `Company: ${org.name}
Industry: ${org.industry || 'home services'}
Region: ${org.region || 'United States'}
Services offered: ${(org.resources?.categories || []).slice(0, 5).map((c) => c.name).join(', ') || 'general home services'}

Generate visual style guidelines that will create a consistent, professional look across all catalog images.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 400,
      response_format: { type: 'json_object' },
    });

    const suggestion = JSON.parse(completion.choices[0].message.content);
    logger.info(`Image style suggested for ${org.slug}`);
    res.json({ success: true, data: suggestion });
  } catch (err) {
    logger.error(`Image style suggest failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

function deploymentOptions(body) {
  return {
    apiUrl: body.apiUrl,
    expectedOrganizationId: body.expectedOrganizationId,
    confirmation: body.confirmation,
    credentials: {
      apiKey: body.apiKey,
    },
  };
}

function validateDeploymentRequest(body) {
  if (!body.apiUrl || !body.apiKey) {
    return 'apiUrl and apiKey are required';
  }
  return null;
}

// POST /api/orgs/:slug/deploy/plan — authenticate, resolve scoped org, and calculate a read-only plan
router.post('/:slug/deploy/plan', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    const validationError = validateDeploymentRequest(req.body);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    logger.info(`Planning deployment for ${org.slug} to ${req.body.apiUrl}`);
    const plan = await preflightOrgDeployment(org, deploymentOptions(req.body));
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/deploy — upsert into the single organization visible to the supplied admin
router.post('/:slug/deploy', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const validationError = validateDeploymentRequest(req.body);
    if (validationError) return res.status(400).json({ success: false, error: validationError });
    if (!req.body.expectedOrganizationId || !req.body.confirmation) {
      return res.status(400).json({ success: false, error: 'Run the deployment plan and confirm its target before deploying' });
    }

    logger.info(`Deploying org ${org.slug} to existing organization ${req.body.expectedOrganizationId} at ${req.body.apiUrl}`);
    const result = await deployOrg(org, deploymentOptions(req.body));

    updateDeploymentLog(org.slug, result, {
      id: req.body.expectedOrganizationId,
      apiUrl: req.body.apiUrl.replace(/\/+$/, ''),
    });

    res.status(result.success ? 200 : 400).json({
      success: result.success,
      data: result,
      error: result.error,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
