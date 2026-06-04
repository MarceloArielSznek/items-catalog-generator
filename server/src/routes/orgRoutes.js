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
import { generateImage, getAvailableProviders } from '../services/imageProviders.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORGS_DIR = path.resolve(__dirname, '../generated-orgs');
const ORG_LOGOS_DIR = path.resolve(__dirname, '../org-logos');
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Org logo helpers ──────────────────────────────────────────────────────────

function orgLogoDir(slug) {
  return path.join(ORG_LOGOS_DIR, slug);
}

function orgLogoPath(slug, variant) {
  return path.join(orgLogoDir(slug), `${variant}.png`);
}

async function processOrgLogo(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 240 && g > 240 && b > 240) data[i + 3] = 0;
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

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
 * GPT-4o generates a precise image prompt based on org context.
 * Works for any industry — no pattern matching needed.
 * Falls back to the static builder if the API call fails.
 */
// Provider-specific prompt formatting — each model has different sweet spots
const PROVIDER_PROMPT_GUIDE = {
  openai: `Write a detailed 2–3 sentence prompt in present tense.
- Open with exactly what the technician is doing and what tools they hold
- Specify the correct location (attic, rooftop, under sink, exterior wall, etc.) based on the service
- Reference the described property and technician appearance for visual consistency
- End with: photorealistic, no text, no logos, no watermarks`,

  replicate: `Write a SHORT, punchy 1–2 sentence prompt for Flux. Flux responds best to concise direct descriptions, not instructions.
Format: [Action + specific tools] at [precise location + brief property detail]. [Technician look in 5-8 words].
Then append comma-separated style tags on a new line: photorealistic, sharp focus, natural light, professional, no text, no logos
Keep everything under 100 words total.`,

  gemini: `Write a detailed 2–3 sentence prompt in present tense for Nano Banana 2 (Google Gemini).
- Open with exactly what the technician is doing and what tools they hold
- Specify the correct location (attic, rooftop, under sink, exterior wall, etc.) based on the service
- Describe the technician appearance and property in full detail — Nano Banana 2 uses these for subject consistency across the catalog
- End with: photorealistic, consistent character, no text, no logos, no watermarks`,
};

async function buildSmartImagePrompt(openai, itemName, categoryName, notes, org, imageStyle = {}, provider = 'openai') {
  const { home, technician, styleNotes } = imageStyle || {};
  const formatGuide = PROVIDER_PROMPT_GUIDE[provider] || PROVIDER_PROMPT_GUIDE.openai;

  const providerLabel = {
    openai: 'gpt-image-1 (OpenAI)',
    replicate: 'Flux 1.1 Pro (Replicate)',
    gemini: 'Nano Banana 2 (Google Gemini)',
  }[provider] || provider;

  const systemPrompt = `You are an expert at writing image generation prompts for professional contractor service catalog photos.
Write prompts that produce photorealistic images showing exactly what the service looks like when a real technician performs it.
Output ONLY the prompt — no explanation, no quotes, no preamble.`;

  const userMessage = [
    `Target model: ${providerLabel}`,
    '',
    `Contractor industry: ${org.industry || 'home services'}`,
    org.region ? `Region: ${org.region}` : '',
    `Service: "${itemName}"`,
    `Category: "${categoryName}"`,
    notes ? `What this service involves: ${notes.replace(/\n+/g, ' ').trim().slice(0, 350)}` : '',
    '',
    'Visual style — maintain across ALL images for this company:',
    home       ? `Property: ${home}`        : 'Property: typical residential home.',
    technician ? `Technician: ${technician}` : '',
    styleNotes ? `Style: ${styleNotes}`      : '',
    '',
    'Instructions:',
    formatGuide,
  ].filter(Boolean).join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: 250,
    temperature: 0.6,
  });

  return response.choices[0].message.content.trim();
}

/**
 * Static fallback prompt builder — used if GPT-4o call fails.
 */
function buildImagePrompt(itemName, categoryName, notes, industry, imageStyle = {}) {
  const { home, technician, styleNotes } = imageStyle || {};
  const combined = `${itemName} ${categoryName} ${notes || ''}`.toLowerCase();

  // ── Scene classifiers — ordered most-specific first ────────────────────────
  const inAttic       = /attic/.test(combined);
  const inCrawl       = /crawl[\s-]?space/.test(combined);
  const isEncapsulate = /encapsulat|vapor\s*barrier|liner/.test(combined);
  const isInsul       = /\b(insulat|blown?[\s-]in|batts|r[\s-]?\d+|cellulose|fiberglass|rockwool)\b/.test(combined);
  const isSprayFoam   = /spray[\s-]?foam|air[\s-]?seal/.test(combined);
  const isMesh        = /\b(mesh|hardware\s*cloth|galv|screen|wire\s*cloth)\b/.test(combined);
  const isSeal        = /\b(seal|caulk|gap|crack|penetrat|exclusion|rodent|pest|entry\s*point)\b/.test(combined);
  const isRodent      = /\b(rodent|mice|rat|pest|vermin|wildlife)\b/.test(combined);
  const isFogging     = /\b(fog|mist|spray|treatment|sanitiz|disinfect|deodor|enzym|botanical)\b/.test(combined);
  const isRemoval     = /\b(remov|haul|demo|strip|pull[\s-]?out|clear|debris|old\s*insul)\b/.test(combined);
  const isEquip       = /\b(unit|system|pump|furnace|ac\b|hvac|compressor|air\s*handler|coil|condenser|heat\s*pump)\b/.test(combined);
  const isInstall     = /\b(install|replac|retrofit|mount|hang|set\s*up|swap|change[\s-]?out|new)\b/.test(combined);
  const isInspect     = /\b(inspect|assess|test|diagnos|evaluat|audit|survey|check)\b/.test(combined);
  const isCleaning    = /\b(clean|flush|purge|wash|vacuum|sanit)\b/.test(combined);
  const isDuct        = /\b(duct|venting|register|diffuser|plenum|duct[\s-]?work)\b/.test(combined);
  const isBarrier     = /\b(radiant\s*barrier|foil|reflective|staple)\b/.test(combined);
  const isElectric    = /\b(electric|wiring|outlet|panel|circuit|breaker)\b/.test(combined);

  // ── Scene description — be specific about the ACTION and TOOLS ─────────────
  let scene;

  if (isRodent && isMesh) {
    scene = `A technician cuts and staples 1/4-inch galvanized wire mesh hardware cloth over a foundation vent opening or gap in the exterior wall to seal rodent entry points. The technician uses wire cutters and a staple gun to firmly secure the mesh. Service: ${itemName}.`;
  } else if (isSeal && isMesh) {
    scene = `A technician installs galvanized wire mesh over exterior openings and vents to prevent pest entry. Cutting and securing mesh with fasteners. Service: ${itemName}.`;
  } else if (isSeal && isSprayFoam) {
    scene = `A technician applies spray foam sealant into gaps and cracks around pipes, wires, and penetrations in the wall or floor to create an airtight seal. Service: ${itemName}.`;
  } else if (isSeal || isRodent) {
    scene = `A technician seals gaps and entry points using appropriate materials (caulk, foam, mesh) around the exterior of the home. Service: ${itemName}.`;
  } else if (inAttic && isRemoval) {
    scene = `A technician inside a residential attic removing old contaminated insulation with an industrial vacuum hose and bagging debris. Service: ${itemName}.`;
  } else if (inAttic && isInsul) {
    scene = `A technician inside a residential attic blowing in insulation using a blower hose, covering the attic floor joists evenly. Service: ${itemName}.`;
  } else if (inAttic && isSprayFoam) {
    scene = `A technician inside a residential attic applying spray foam to seal air leaks around penetrations, wires, and ducts before insulating. Service: ${itemName}.`;
  } else if (inAttic && isBarrier) {
    scene = `A technician inside a residential attic stapling radiant barrier foil to the rafters, reflecting heat away from the living space below. Service: ${itemName}.`;
  } else if (inAttic && isFogging) {
    scene = `A technician inside a residential attic using a fogging machine to apply disinfectant or deodorizing treatment throughout the space. Service: ${itemName}.`;
  } else if (inAttic && isCleaning) {
    scene = `A technician inside a residential attic using a HEPA vacuum to clean surfaces and remove dust, debris, and contaminants. Service: ${itemName}.`;
  } else if (inAttic) {
    scene = `A technician working inside a residential attic performing ${itemName}.`;
  } else if (inCrawl && isEncapsulate) {
    scene = `A technician inside a residential crawl space laying and sealing heavy-duty plastic vapor barrier sheeting across the dirt floor, overlapping seams and taping edges. Service: ${itemName}.`;
  } else if (inCrawl) {
    scene = `A technician working inside a residential crawl space performing ${itemName}.`;
  } else if (isFogging) {
    scene = `A technician using a fogging or misting machine to apply treatment throughout a residential space. Service: ${itemName}.`;
  } else if (isRemoval) {
    scene = `A technician removing old material and hauling debris away from a residential property. Service: ${itemName}.`;
  } else if (isInspect) {
    scene = `A technician carefully inspecting a residential property with a flashlight and clipboard, documenting findings. Service: ${itemName}.`;
  } else if (isCleaning) {
    scene = `A technician performing a professional cleaning service at a residential property. Service: ${itemName}.`;
  } else if (isDuct) {
    scene = `A technician working on the ductwork system inside a home, connecting, sealing, or cleaning ducts. Service: ${itemName}.`;
  } else if (isEquip || isInstall) {
    scene = `A technician actively installing ${itemName} at a residential property, using proper tools and equipment.`;
  } else {
    scene = `A professional technician performing the following service at a residential home: ${itemName}.`;
  }

  // ── Notes as primary context — put first so AI understands the work fully ──
  // Notes describe exactly what the service involves; this heavily guides the image
  const serviceCtx = notes
    ? `What this service involves: ${notes.replace(/\n+/g, ' ').trim().slice(0, 300)}`
    : `Category: ${categoryName}${industry ? ` — ${industry}` : ''}.`;

  // ── Property / setting ─────────────────────────────────────────────────────
  const property = home
    ? `Property: ${home}.`
    : `At a typical residential property${industry ? ` for a ${industry} contractor` : ''}.`;

  // ── Technician appearance ──────────────────────────────────────────────────
  const worker = technician
    ? `The technician: ${technician}.`
    : `A professional technician in clean work uniform and appropriate safety gear.`;

  // ── Visual style / quality ─────────────────────────────────────────────────
  const quality = [
    styleNotes ? `Style: ${styleNotes}.` : 'Style: clean, bright, professional.',
    'Photorealistic photograph, natural lighting, sharp focus on the work being performed.',
    'Show the technician using the correct, realistic tools for this specific service.',
    'Real residential job site — not a staged studio look.',
    'No text, no logos, no watermarks.',
  ].join(' ');

  // Notes go FIRST so they anchor the AI's understanding, then scene, then property/worker/style
  return [serviceCtx, scene, property, worker, quality].filter(Boolean).join('\n');
}

async function generateImageBuffer(openai, prompt, model = 'gpt-image-1', quality = 'low') {
  const options = {
    model,
    prompt,
    n: 1,
    size: '1536x1024',
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
  const updated = deepUpdateItem(currentOrg, categoryName, itemName, { imageUrl, imageUpdatedAt: Date.now(), ...patch });
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
  res.setHeader('Cache-Control', 'no-store');
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
// GET /api/orgs/image-providers — which providers are configured
router.get('/image-providers', (_req, res) => {
  res.json({ success: true, data: getAvailableProviders() });
});

router.post('/:slug/resources/item-image/generate', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const {
      categoryName, itemName, notes,
      provider = 'openai',
      model = 'gpt-image-1',
      quality = 'medium',
    } = req.body;
    if (!categoryName || !itemName) return res.status(400).json({ success: false, error: 'categoryName and itemName required' });

    logger.info(`Generating image: ${org.slug} / ${itemName} [${provider} ${model} ${quality}]`);

    // GPT-4o builds the smart prompt (always uses OpenAI for this, regardless of image provider)
    const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
    let prompt;
    try {
      if (!openai) throw new Error('No OpenAI key for prompt generation');
      prompt = await buildSmartImagePrompt(openai, itemName, categoryName, notes, org, org.imageStyle, provider);
      logger.info(`Smart prompt [${provider}]: ${prompt.slice(0, 120)}…`);
    } catch (promptErr) {
      logger.warn(`GPT-4o prompt failed, using static builder: ${promptErr.message}`);
      prompt = buildImagePrompt(itemName, categoryName, notes, org.industry, org.imageStyle);
    }

    const buf = await generateImage(prompt, { provider, model, quality });
    const url = await saveItemImage(req.params.slug, categoryName, itemName, buf, { imageSource: `${provider}:${model}` });
    logger.info(`Image saved: ${req.params.slug} / ${itemName}`);
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

  const { categoryName, mode = 'generate', provider = 'openai', model = 'gpt-image-1', quality = 'low', overwrite = false } = req.body;
  const cat = org.resources.categories.find((c) => c.name === categoryName);
  if (!cat) return res.status(404).json({ success: false, error: 'Category not found' });

  if (!['generate', 'web'].includes(mode)) return res.status(400).json({ success: false, error: 'mode must be generate or web' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // GPT-4o for prompt building (separate from image provider)
  const promptOpenAI = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
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
        let prompt;
        try {
          if (!promptOpenAI) throw new Error('No OpenAI key');
          prompt = await buildSmartImagePrompt(promptOpenAI, item.name, categoryName, item.notes || item.itemInfo, org, org.imageStyle, provider);
        } catch (promptErr) {
          logger.warn(`Smart prompt failed for "${item.name}", using fallback: ${promptErr.message}`);
          prompt = buildImagePrompt(item.name, categoryName, item.notes || item.itemInfo, org.industry, org.imageStyle);
        }
        inputBuffer = await generateImage(prompt, { provider, model, quality });
        imageSource = `${provider}:${model}`;
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

// ── Org logo routes ───────────────────────────────────────────────────────────

// GET /api/orgs/:slug/logo — list uploaded variants
router.get('/:slug/logo', (req, res) => {
  try {
    const dir = orgLogoDir(req.params.slug);
    let variants = [];
    try {
      variants = fs.readdirSync(dir).filter(f => f.endsWith('.png')).map(f => f.replace('.png', ''));
    } catch { /* no logos yet */ }
    res.json({ success: true, data: variants });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/orgs/:slug/logo/:variant — serve logo PNG
router.get('/:slug/logo/:variant', (req, res) => {
  const p = orgLogoPath(req.params.slug, req.params.variant);
  if (!fs.existsSync(p)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(p).pipe(res);
});

// POST /api/orgs/:slug/logo/:variant — upload logo variant
router.post('/:slug/logo/:variant', mediaUpload.single('logo'), async (req, res) => {
  try {
    const { slug, variant } = req.params;
    if (!['white', 'dark', 'color', 'default'].includes(variant)) {
      return res.status(400).json({ success: false, error: 'Invalid variant — use white, dark, color, or default' });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });
    fs.mkdirSync(orgLogoDir(slug), { recursive: true });
    const png = await processOrgLogo(req.file.buffer);
    fs.writeFileSync(orgLogoPath(slug, variant), png);
    logger.info(`Org logo uploaded: ${slug}/${variant}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/orgs/:slug/logo/:variant — delete logo variant
router.delete('/:slug/logo/:variant', (req, res) => {
  try {
    const p = orgLogoPath(req.params.slug, req.params.variant);
    try { fs.unlinkSync(p); } catch { /* already gone */ }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/bulk-logo-apply — stamp logo on all item images, keep originals
router.post('/:slug/bulk-logo-apply', async (req, res) => {
  try {
    const { slug } = req.params;
    const org = getOrg(slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const logoDir = orgLogoDir(slug);
    let logoVariants = [];
    try {
      logoVariants = fs.readdirSync(logoDir).filter(f => f.endsWith('.png')).map(f => f.replace('.png', ''));
    } catch { /* none */ }
    if (logoVariants.length === 0) {
      return res.status(400).json({ success: false, error: 'No logo uploaded for this org' });
    }

    const succeeded = [];
    const failed = [];
    const updatedOrg = JSON.parse(JSON.stringify(org));

    for (const cat of org.resources?.categories || []) {
      for (const item of cat.items || []) {
        if (!item.imageUrl) continue;
        const key = imageKey(cat.name, item.name);
        const imgPath = imageFilePath(slug, key);
        if (!fs.existsSync(imgPath)) {
          failed.push({ item: item.name, error: 'Image file not found on disk' });
          continue;
        }

        try {
          const imageBuffer = fs.readFileSync(imgPath);
          const { width, height } = await sharp(imageBuffer).metadata();
          const margin = Math.round(width * 0.04);
          const sampleSize = Math.min(120, Math.round(width * 0.25));
          const zone = { left: Math.max(0, width - sampleSize - margin), top: Math.max(0, height - sampleSize - margin) };

          const { data: sd } = await sharp(imageBuffer)
            .extract({ ...zone, width: sampleSize, height: sampleSize })
            .resize(8, 8).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          let rr = 0, gg = 0, bb = 0;
          for (let i = 0; i < sd.length; i += 3) { rr += sd[i]; gg += sd[i + 1]; bb += sd[i + 2]; }
          const bright = (rr + gg + bb) / (3 * (sd.length / 3));

          let preferred;
          if (bright < 90)        preferred = ['white', 'color', 'default', 'dark'];
          else if (bright < 160)  preferred = ['color', 'white', 'default', 'dark'];
          else                    preferred = ['dark', 'color', 'default', 'white'];
          const bestVariant = preferred.find(v => logoVariants.includes(v)) || logoVariants[0];

          const logoBuffer = fs.readFileSync(orgLogoPath(slug, bestVariant));
          const maxLogoW = Math.round(width * 0.25);
          const resizedLogo = await sharp(logoBuffer).resize({ width: maxLogoW, withoutEnlargement: true }).png().toBuffer();
          const { width: logoW, height: logoH } = await sharp(resizedLogo).metadata();
          const pos = { left: width - logoW - margin, top: height - logoH - margin };

          let finalLogo = resizedLogo;
          if (bright > 140) finalLogo = await sharp(resizedLogo).negate({ alpha: false }).toBuffer();

          const finalBuffer = await sharp(imageBuffer)
            .composite([{ input: finalLogo, top: pos.top, left: pos.left }])
            .jpeg({ quality: 90 })
            .toBuffer();

          // Save as {key}__logo.jpg — original stays untouched
          const logoKey = `${key}__logo`;
          fs.writeFileSync(imageFilePath(slug, logoKey), finalBuffer);
          const imageUrlWithLogo = imageApiUrl(slug, logoKey);

          const updCat = updatedOrg.resources.categories.find(c => c.name === cat.name);
          const updItem = updCat?.items.find(i => i.name === item.name);
          if (updItem) updItem.imageUrlWithLogo = imageUrlWithLogo;

          succeeded.push({ item: item.name });
        } catch (err) {
          logger.warn(`Bulk logo: failed "${item.name}": ${err.message}`);
          failed.push({ item: item.name, error: err.message });
        }
      }
    }

    if (succeeded.length > 0) saveOrg(updatedOrg);
    logger.info(`Bulk logo apply: ${slug} — ${succeeded.length} ok, ${failed.length} failed`);
    res.json({ success: true, data: { succeeded: succeeded.length, failed } });
  } catch (err) {
    logger.error(`Bulk logo apply failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

function deploymentOptions(body) {
  return {
    apiUrl: body.apiUrl,
    expectedOrganizationId: body.expectedOrganizationId,
    confirmation: body.confirmation,
    credentials: {
      email: body.email,
      password: body.password,
      supabaseUrl: body.supabaseUrl,
      publishableKey: body.publishableKey,
      vercelToken: body.vercelToken,
    },
  };
}

function validateDeploymentRequest(body) {
  if (!body.apiUrl || !body.email || !body.password) {
    return 'apiUrl, email, and password are required';
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
