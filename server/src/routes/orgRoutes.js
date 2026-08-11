import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import sharp from 'sharp';
import OpenAI from 'openai';
import * as XLSX from 'xlsx';
import { listOrgs, getOrg, saveOrg, updateOrg, deleteOrg, updateDeploymentLog } from '../services/orgStorageService.js';
import { deployOrg, preflightOrgDeployment } from '../services/deploymentService.js';
import { seedDemoData, planDemoData } from '../services/demoDataService.js';
import { addWorkAreaToOrg, generateWorkAreaCatalog } from '../services/seedGenerator/multiIndustryDemo.js';
import { improveItemDescriptions, generateProposalContent, generateUserIdentities, inferGenderFromName } from '../services/seedGenerator/improve.js';
import { downloadImage, findBestImage, findImageCandidates } from '../services/imageSearchService.js';
import { generateImage, getAvailableProviders } from '../services/imageProviders.js';
import { removeBackground as imglyRemoveBackground } from '@imgly/background-removal-node';
import env from '../config/env.js';
import { getMenaiaApiUrl, getMenaiaApiKey, validateMenaiaConfig, getSupabaseUrl, getSupabaseAnonKey, getPayloadUrl, validateDemoDataConfig } from '../config/menaiaContext.js';
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

// Remove the logo's background with the app's ML background remover (the same
// @imgly model used for item images). This is model-agnostic — it segments the
// emblem regardless of what background the image model painted — so we don't
// depend on the generator honoring a background-colour instruction. Returns a
// trimmed, size-capped transparent PNG.
async function knockoutLogoBackground(rawBuffer) {
  const blob = new Blob([rawBuffer], { type: 'image/png' });
  const out = await imglyRemoveBackground(blob, { output: { format: 'image/png', quality: 1 } });
  const transparent = Buffer.from(await out.arrayBuffer());
  return sharp(transparent)
    .trim()
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

// Build a clean "YOUR LOGO" placeholder — for demo orgs where a real logo isn't
// available yet. A dark translucent rounded pill with white text + image icon,
// which reads on both light and dark photos. Returns a transparent PNG.
async function buildLogoPlaceholder(label = 'YOUR LOGO') {
  const safe = String(label).toUpperCase().replace(/[<&>]/g, '').slice(0, 18) || 'YOUR LOGO';
  const svg = `<svg width="720" height="300" xmlns="http://www.w3.org/2000/svg">
  <rect x="6" y="6" width="708" height="288" rx="40"
        fill="rgba(15,23,42,0.74)" stroke="rgba(255,255,255,0.6)" stroke-width="4"/>
  <g transform="translate(74,116)" stroke="#ffffff" stroke-width="6" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <rect x="0" y="0" width="86" height="68" rx="10"/>
    <circle cx="24" cy="24" r="10" fill="#ffffff" stroke="none"/>
    <path d="M5 62 L32 34 L52 54 L66 42 L81 58"/>
  </g>
  <text x="200" y="138" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="700" fill="#ffffff" letter-spacing="2">${safe}</text>
  <text x="202" y="196" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="400" fill="rgba(255,255,255,0.78)" letter-spacing="4">DEMO PLACEHOLDER</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── Logo compositing ─────────────────────────────────────────────────────────

// Default config for the optional logo backdrop ("scrim") — a soft translucent
// oval/rounded plate painted behind the logo so it stays legible over busy or
// light photos. Disabled by default; enabled + tuned per-org from Settings.
export const LOGO_BACKDROP_DEFAULTS = { enabled: false, shape: 'ellipse', color: 'auto', opacity: 0.5 };

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Mean luminance of the logo's *opaque* pixels (0–255). Drives the auto backdrop
// colour: a light logo needs a dark plate to read, and vice-versa — contrast is
// against the logo itself, not the photo behind it.
async function logoMeanLuminance(logoBuffer) {
  try {
    const { data, info } = await sharp(logoBuffer)
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let lum = 0, n = 0;
    for (let i = 0; i < data.length; i += ch) {
      const a = ch === 4 ? data[i + 3] : 255;
      if (a < 32) continue; // ignore transparent padding
      lum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      n++;
    }
    return n ? lum / n : 128;
  } catch {
    return 128;
  }
}

// Coerce an untrusted backdrop config (from settings or request body) into a
// known-good shape, falling back to defaults for any missing/invalid field.
export function normalizeLogoBackdrop(backdrop) {
  const b = backdrop || {};
  return {
    enabled: !!b.enabled,
    shape: ['ellipse', 'rounded'].includes(b.shape) ? b.shape : LOGO_BACKDROP_DEFAULTS.shape,
    color: ['auto', 'dark', 'light'].includes(b.color) ? b.color : LOGO_BACKDROP_DEFAULTS.color,
    opacity: clamp(typeof b.opacity === 'number' ? b.opacity : LOGO_BACKDROP_DEFAULTS.opacity, 0.05, 0.9),
  };
}

// Build a full-canvas transparent layer holding a single blurred ellipse/rounded
// plate centred on the logo. Full-canvas keeps the geometry simple (no negative
// composite offsets when the plate bleeds past a corner). `color: 'auto'` picks
// a plate that *contrasts the logo* (dark plate for a light logo, light for a
// dark one) so the mark always reads, regardless of what's behind it.
async function buildLogoBackdrop(imageBuffer, { left, top, rw, rh, W, H, cfg, logoBuffer }) {
  const padX = Math.round(rw * 0.45);
  const padY = Math.round(rh * 0.55);
  const cx = left + rw / 2;
  const cy = top + rh / 2;
  const rx = rw / 2 + padX;
  const ry = rh / 2 + padY;

  let dark = cfg.color === 'dark';
  if (cfg.color === 'auto') {
    const lum = await logoMeanLuminance(logoBuffer);
    dark = lum > 140; // light logo → dark plate
  }
  const rgb = dark ? '15,23,42' : '255,255,255';
  const o = cfg.opacity.toFixed(3);

  let shape;
  if (cfg.shape === 'rounded') {
    const bw = rw + padX * 2;
    const bh = rh + padY * 2;
    const r = Math.round(Math.min(bw, bh) * 0.32);
    shape = `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(cy - bh / 2).toFixed(1)}" width="${bw}" height="${bh}" rx="${r}" ry="${r}" fill="rgba(${rgb},${o})"/>`;
  } else {
    shape = `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="rgba(${rgb},${o})"/>`;
  }
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${shape}</svg>`;
  const blur = Math.max(4, Math.round(Math.min(rx, ry) * 0.35));
  const scrimBuf = await sharp(Buffer.from(svg)).blur(blur).png().toBuffer();
  return { input: scrimBuf, left: 0, top: 0 };
}

// Auto-pick the corner where a watermark reads best: the *calmest* one (lowest
// luminance variance → flattest, least-detailed area), so the logo doesn't land
// on a busy subject. The backdrop already handles contrast, so busyness — not
// brightness — is the right signal. Returns a corner position string.
async function pickLogoCorner(imageBuffer, W, H) {
  const zone = Math.min(Math.round(W * 0.30), Math.round(H * 0.30));
  if (!zone) return 'bottom-left';
  const corners = [
    { name: 'top-left',     left: 0,        top: 0 },
    { name: 'top-right',    left: W - zone, top: 0 },
    { name: 'bottom-left',  left: 0,        top: H - zone },
    { name: 'bottom-right', left: W - zone, top: H - zone },
  ];
  const scored = await Promise.all(corners.map(async (c) => {
    try {
      const { data } = await sharp(imageBuffer)
        .extract({ left: Math.max(0, c.left), top: Math.max(0, c.top), width: zone, height: zone })
        .greyscale()
        .resize(16, 16, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const mean = sum / data.length;
      let varSum = 0;
      for (let i = 0; i < data.length; i++) { const d = data[i] - mean; varSum += d * d; }
      return { name: c.name, std: Math.sqrt(varSum / data.length) };
    } catch {
      return { name: c.name, std: Number.POSITIVE_INFINITY };
    }
  }));
  scored.sort((a, b) => a.std - b.std);
  logger.info(`Auto logo corner: ${scored[0].name} (busyness ${scored[0].std.toFixed(1)})`);
  return scored[0].name;
}

/**
 * Composite the org's logo as a clean corner watermark: one full-colour variant,
 * a fixed corner (default bottom-left). `position` ∈ auto | bottom-left |
 * bottom-right | top-left | top-right. `auto` scans each photo and picks the
 * calmest corner. Pass `backdrop` to paint a translucent oval/rounded plate
 * behind the logo so it reads on light or busy photos.
 */
async function composeLogo(imageBuffer, slug, logoVariants, position = 'bottom-left', backdrop = null) {
  // Normalize the base to a 1:1 square BEFORE stamping so the logo never bleeds
  // past the proposal's square frame. This also re-squares legacy landscape
  // images when logos are re-applied, and is a no-op for already-square bases.
  imageBuffer = await sharp(imageBuffer).resize(1024, 1024, { fit: 'cover' }).jpeg({ quality: 92 }).toBuffer();
  const meta = await sharp(imageBuffer).metadata();
  const W = meta.width, H = meta.height;
  const margin = Math.round(W * 0.04);

  // Resolve an "auto" placement to a concrete corner for this specific photo.
  if (position === 'auto') {
    position = await pickLogoCorner(imageBuffer, W, H);
  }

  // Always the real, full-colour logo — no brightness-based variant switching.
  const variant = ['color', 'default'].find((v) => logoVariants.includes(v)) || logoVariants[0];

  // Trim transparent padding so the logo sits flush against the corner margin.
  let logo;
  try { logo = await sharp(orgLogoPath(slug, variant)).trim().png().toBuffer(); }
  catch { logo = await sharp(orgLogoPath(slug, variant)).png().toBuffer(); }

  // Size to ~22% of the image width, but never taller than ~16% of the height.
  const probe = await sharp(logo).metadata();
  const aspect = (probe.height || 1) / (probe.width || 1);
  let lw = Math.round(W * 0.22);
  let lh = Math.round(lw * aspect);
  const maxH = Math.round(H * 0.16);
  if (lh > maxH) { lh = maxH; lw = Math.round(lh / aspect); }

  const logoResized = await sharp(logo)
    .resize({ width: lw, height: lh, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  const rMeta = await sharp(logoResized).metadata();
  const rw = rMeta.width, rh = rMeta.height;

  const isRight = position.endsWith('right');
  const isTop = position.startsWith('top');
  const left = isRight ? W - rw - margin : margin;
  const top = isTop ? margin : H - rh - margin;

  const layers = [];

  // Optional translucent backdrop so the logo reads on busy / light photos.
  const cfg = normalizeLogoBackdrop(backdrop);
  if (cfg.enabled) {
    try {
      layers.push(await buildLogoBackdrop(imageBuffer, { left, top, rw, rh, W, H, cfg, logoBuffer: logoResized }));
    } catch (err) {
      logger.warn(`Logo backdrop failed, skipping: ${err.message}`);
    }
  }

  layers.push({ input: logoResized, left, top });

  const buffer = await sharp(imageBuffer)
    .composite(layers)
    .jpeg({ quality: 92 })
    .toBuffer();
  return { buffer, variant, position };
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

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function imageFilePath(slug, key) {
  return path.join(mediaDir(slug), `${key}.jpg`);
}

function imageApiUrl(slug, key) {
  return `/api/orgs/${slug}/media/${key}.jpg`;
}

// ── User-avatar helpers (one square jpg per user, keyed by email) ──────────────
function userAvatarDir(slug) {
  return path.join(ORGS_DIR, 'user-avatars', slug);
}
function userKey(email) {
  return (email || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
function userAvatarPath(slug, key) {
  return path.join(userAvatarDir(slug), `${key}.jpg`);
}
function userAvatarApiUrl(slug, key) {
  return `/api/orgs/${slug}/user-avatar/${key}.jpg`;
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

async function buildSmartImagePrompt(openai, itemName, categoryName, notes, org, imageStyle = {}, provider = 'openai', comment = '') {
  const { home, technician, styleNotes } = imageStyle || {};
  const formatGuide = PROVIDER_PROMPT_GUIDE[provider] || PROVIDER_PROMPT_GUIDE.openai;
  const avoid = (comment || '').replace(/\n+/g, ' ').trim().slice(0, 400);

  const providerLabel = {
    openai: 'gpt-image-1 (OpenAI)',
    replicate: 'Flux 1.1 Pro (Replicate)',
    gemini: 'Nano Banana 2 (Google Gemini)',
  }[provider] || provider;

  const systemPrompt = `You are an expert at writing image generation prompts for professional contractor service catalog photos.
Write prompts that produce photorealistic images showing exactly what the service looks like when a real technician performs it.
Image models are negation-blind: never write "no X", "without X", "avoid X", or "not X" — they tend to render exactly the thing you tell them to exclude. To exclude something, describe its positive opposite concretely (e.g. for "no open attic" describe "a fully enclosed attic with solid sheathed walls and no daylight"; for "no female technician" describe "a male technician").
When the user gives EXCLUSIONS, they override the saved visual style wherever they conflict.
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
    avoid ? `EXCLUDE THESE (the user reviewed past images and these must NOT appear): ${avoid}.` : '',
    avoid ? `For each exclusion, write the positive opposite directly into the scene description — describe what IS there instead, never "no/without/avoid". These exclusions override the visual style above if they conflict.` : '',
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
function buildImagePrompt(itemName, categoryName, notes, industry, imageStyle = {}, comment = '') {
  const { home, technician, styleNotes } = imageStyle || {};
  const avoid = (comment || '').replace(/\n+/g, ' ').trim().slice(0, 400);
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
    avoid ? `Avoid these unrealistic elements: ${avoid}.` : '',
  ].filter(Boolean).join(' ');

  // Notes go FIRST so they anchor the AI's understanding, then scene, then property/worker/style
  return [serviceCtx, scene, property, worker, quality].filter(Boolean).join('\n');
}

async function generateImageBuffer(openai, prompt, model = 'gpt-image-1', quality = 'low') {
  const options = {
    model,
    prompt,
    n: 1,
    size: '1024x1024',
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

// Serializes the org-JSON read-modify-write so concurrent image saves (the bulk
// flow now generates several at once) can't clobber each other's imageUrl update.
// Only the fast getOrg→patch→saveOrg is inside the lock; the slow image work runs
// in parallel. Keyed nothing fancy — a single global chain is enough here.
let orgWriteChain = Promise.resolve();
function withOrgWriteLock(fn) {
  const result = orgWriteChain.then(fn, fn);
  orgWriteChain = result.then(() => {}, () => {}); // keep the chain alive on error
  return result;
}

async function saveItemImage(slug, categoryName, itemName, inputBuffer, patch = {}) {
  const key = imageKey(categoryName, itemName);
  fs.mkdirSync(mediaDir(slug), { recursive: true });
  // Square (1:1) so the proposal renders it without cropping and the stamped
  // logo never bleeds past the visible frame.
  const buf = await sharp(inputBuffer).resize(1024, 1024, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
  fs.writeFileSync(imageFilePath(slug, key), buf);

  const imageUrl = imageApiUrl(slug, key);
  // Guard the read-modify-write: a bare getOrg→deepUpdateItem→saveOrg would lose
  // updates when two saves overlap (both read, both write, second wins).
  await withOrgWriteLock(() => {
    const currentOrg = getOrg(slug);
    const updated = deepUpdateItem(currentOrg, categoryName, itemName, { imageUrl, imageUpdatedAt: Date.now(), ...patch });
    saveOrg(updated);
  });
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

// POST /api/orgs/:slug/clone-to-real — spin a real client org off a demo template.
// Reuses the demo's catalog + curated item images; swaps in real identity. By
// default the logo is NOT copied (the client gets its own); pass copyLogo:true
// to carry the demo's logo (e.g. the "YOUR LOGO" placeholder) into the new org.
router.post('/:slug/clone-to-real', (req, res) => {
  try {
    const demo = getOrg(req.params.slug);
    if (!demo) return res.status(404).json({ success: false, error: 'Org not found' });

    const { companyName, companyWebsite, domain, timezone, region, copyLogo = false } = req.body || {};
    if (!companyName?.trim()) return res.status(400).json({ success: false, error: 'companyName is required' });

    // Unique slug derived from the real company name
    const base = slugify(companyName) || 'org';
    let slug = base;
    let n = 2;
    while (getOrg(slug)) slug = `${base}-${n++}`;

    // Deep-copy the demo catalog, swap identity, mark as a real client draft
    const clone = JSON.parse(JSON.stringify(demo));
    clone.slug = slug;
    clone.name = companyName.trim();
    clone.source = 'real_client';
    clone.status = 'draft';
    clone.websiteUrl = (companyWebsite || '').trim();
    clone.domain = (domain || slug).trim();
    if (timezone) clone.timezone = timezone;
    if (region) clone.region = region;
    clone.createdAt = new Date().toISOString();
    clone.clonedFrom = demo.slug;
    delete clone.deployment; // fresh org — don't inherit the demo's deploy log/ids

    // Re-point item image URLs to the new org's media path
    const fromPrefix = `/api/orgs/${demo.slug}/media/`;
    const toPrefix = `/api/orgs/${slug}/media/`;
    for (const cat of clone.resources?.categories || []) {
      for (const item of cat.items || []) {
        if (typeof item.imageUrl === 'string' && item.imageUrl.startsWith(fromPrefix)) {
          item.imageUrl = item.imageUrl.replace(fromPrefix, toPrefix);
        }
      }
    }

    // Copy the curated item images (the reuse the user asked for)
    const srcMedia = mediaDir(demo.slug);
    if (fs.existsSync(srcMedia)) fs.cpSync(srcMedia, mediaDir(slug), { recursive: true });

    // Optionally carry the demo's logo (default placeholder or generated) into
    // the new org so it starts branded instead of logo-less.
    let logoCopied = false;
    if (copyLogo) {
      const srcLogos = orgLogoDir(demo.slug);
      if (fs.existsSync(srcLogos)) {
        fs.cpSync(srcLogos, orgLogoDir(slug), { recursive: true });
        logoCopied = true;
      }
    }

    saveOrg(clone);
    logger.info(`Cloned demo ${demo.slug} → real client ${slug}${logoCopied ? ' (logo copied)' : ''}`);
    res.json({ success: true, data: { slug, org: clone, logoCopied } });
  } catch (err) {
    logger.error(`Clone-to-real failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/orgs/:slug/settings — update org info and/or branch config for all branches
router.patch('/:slug/settings', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const { orgInfo, branchConfig, financingTerms, proposalContent, imageStyle, logoOverlay } = req.body;
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

    // Logo overlay config (corner + translucent backdrop) used when stamping the
    // logo onto every catalog image. Normalize the backdrop so only known fields persist.
    if (logoOverlay !== undefined) {
      const validPositions = ['auto', 'bottom-left', 'bottom-right', 'top-left', 'top-right'];
      const lo = logoOverlay || {};
      updated.logoOverlay = {
        position: validPositions.includes(lo.position) ? lo.position : 'bottom-left',
        backdrop: normalizeLogoBackdrop(lo.backdrop),
      };
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

// ── AI improve actions ────────────────────────────────────────────────────────

// POST /api/orgs/:slug/improve-descriptions — regenerate the customer-facing
// `notes` for every item (or one category) into richer 3-5 sentence copy. Body:
// { categoryName? }. Writes the new notes back into the org and returns it.
router.post('/:slug/improve-descriptions', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    if (!env.OPENAI_API_KEY) return res.status(400).json({ success: false, error: 'No OpenAI API key configured' });

    const { categoryName } = req.body || {};
    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const descByName = await improveItemDescriptions(org, openai, { categoryName });

    let updatedCount = 0;
    const categories = (org.resources?.categories || []).map((category) => ({
      ...category,
      items: (category.items || []).map((item) => {
        const next = descByName[item.name];
        if (next && next !== item.itemInfo) {
          updatedCount += 1;
          // Single description field; drop any legacy `notes` so it can't shadow it.
          const { notes, ...rest } = item;
          return { ...rest, itemInfo: next };
        }
        return item;
      }),
    }));

    const updated = { ...org, resources: { ...org.resources, categories } };
    saveOrg(updated);
    res.json({ success: true, data: updated, meta: { updated: updatedCount } });
  } catch (err) {
    logger.error(`[improve-descriptions] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/generate-proposal-content — regenerate the proposalContent
// block (about, disclaimer, payment/insurance terms, T&C, email template) and
// apply it to every branch. Returns the updated org.
router.post('/:slug/generate-proposal-content', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    if (!env.OPENAI_API_KEY) return res.status(400).json({ success: false, error: 'No OpenAI API key configured' });

    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const proposalContent = await generateProposalContent(org, openai);

    const updated = {
      ...org,
      branches: (org.branches || []).map((b) => ({ ...b, ...proposalContent })),
    };
    saveOrg(updated);
    res.json({ success: true, data: updated, meta: { proposalContent } });
  } catch (err) {
    logger.error(`[generate-proposal-content] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Multi-industry work areas (add industry + generate its catalog) ───────────

// POST /api/orgs/:slug/work-areas — add an empty work area (industry) to the org.
router.post('/:slug/work-areas', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    addWorkAreaToOrg(org, req.body?.name);
    saveOrg(org);
    res.json({ success: true, data: { org, stats: org.stats } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/work-areas/generate-catalog — generate one industry's
// catalog (categories + items) and append it to a work area. SSE (one o3 call).
// Body: { workArea, industry?, categoriesPerIndustry?, itemsPerCategory? }.
router.post('/:slug/work-areas/generate-catalog', async (req, res) => {
  const org = getOrg(req.params.slug);
  if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ success: false, error: 'OPENAI_API_KEY not configured' });
  if (!req.body?.workArea) return res.status(400).json({ success: false, error: 'workArea is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const openai = new OpenAI({ apiKey });
    const result = await generateWorkAreaCatalog(org, {
      workArea: req.body.workArea,
      industry: req.body.industry,
      categoriesPerIndustry: req.body.categoriesPerIndustry,
      itemsPerCategory: req.body.itemsPerCategory,
    }, openai, (entry) => send({ type: 'step', entry }));
    send({ type: 'done', result: result.success
      ? { success: true, addedCats: result.addedCats, addedItems: result.addedItems, stats: result.org.stats, log: result.log }
      : { success: false, error: result.error, log: result.log } });
    res.end();
  } catch (err) {
    send({ type: 'done', result: { success: false, error: err.message, log: [] } });
    res.end();
  }
});

// ── User management (manual edits + AI identities/avatars) ────────────────────

// GET /api/orgs/:slug/user-avatar/:filename — serve a stored user avatar
router.get('/:slug/user-avatar/:filename', (req, res) => {
  const key = req.params.filename.replace(/\.jpg$/i, '');
  const p = userAvatarPath(req.params.slug, key);
  if (!fs.existsSync(p)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(p).pipe(res);
});

// PATCH /api/orgs/:slug/users — replace the org's users array (manual edits)
router.patch('/:slug/users', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    const { users } = req.body;
    if (!Array.isArray(users)) return res.status(400).json({ success: false, error: 'users must be an array' });
    const updated = saveOrg({ ...org, users });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/users/generate-identities — AI name+about for users.
// Body: { emails? } (omit for all users).
router.post('/:slug/users/generate-identities', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    if (!env.OPENAI_API_KEY) return res.status(400).json({ success: false, error: 'No OpenAI API key configured' });

    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const identities = await generateUserIdentities(org, openai, { emails: req.body?.emails });

    let updatedCount = 0;
    const users = (org.users || []).map((u) => {
      const next = identities[u.email];
      if (!next) return u;
      updatedCount += 1;
      return { ...u, ...(next.name ? { name: next.name } : {}), ...(next.about ? { about: next.about } : {}) };
    });
    const updated = saveOrg({ ...org, users });
    res.json({ success: true, data: updated, meta: { updated: updatedCount } });
  } catch (err) {
    logger.error(`[generate-identities] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Build a gender-aware AI headshot for a user and store it as a square jpg.
// Gender is inferred from the user's first name (cheap gpt-4o-mini) so the photo
// matches the person; falls back to a stored user.gender if present. The image
// itself uses gpt-image-1 'low' — the cheapest configured model (~$0.006/image).
async function generateAndSaveUserAvatar(slug, org, user, openai, imageOpts = {}) {
  const firstName = (user.name || '').trim().split(/\s+/)[0] || '';
  const gender = user.gender || (await inferGenderFromName(firstName, openai));
  const genderWord = gender === 'male' ? 'male' : gender === 'female' ? 'female' : '';
  const role = user.role || 'team member';
  const industry = org.industry || 'home services';
  const prompt = `Professional corporate headshot photograph of a ${genderWord} ${role} at a ${industry} company. Friendly approachable expression, business-casual attire, looking directly at the camera, soft evenly-lit neutral studio background, sharp focus, head and shoulders, centered. Realistic photo.`.replace(/\s+/g, ' ').trim();

  // Provider/model/quality are chosen in the UI (defaults to gpt-image-1 low).
  const { provider = 'openai', model = 'gpt-image-1', quality = 'low' } = imageOpts;
  const raw = await generateImage(prompt, { provider, model, quality });
  const buf = await sharp(raw).resize(512, 512, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
  const key = userKey(user.email);
  fs.mkdirSync(userAvatarDir(slug), { recursive: true });
  fs.writeFileSync(userAvatarPath(slug, key), buf);
  return userAvatarApiUrl(slug, key);
}

// POST /api/orgs/:slug/users/avatar/generate — AI headshot for one user.
// Body: { email }.
router.post('/:slug/users/avatar/generate', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    if (!env.OPENAI_API_KEY) return res.status(400).json({ success: false, error: 'No OpenAI API key configured' });

    const { email, provider, model, quality } = req.body || {};
    const user = (org.users || []).find((u) => u.email === email);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const avatarUrl = await generateAndSaveUserAvatar(req.params.slug, org, user, openai, { provider, model, quality });

    const users = (org.users || []).map((u) => (u.email === email ? { ...u, avatarUrl } : u));
    saveOrg({ ...org, users });
    res.json({ success: true, data: { avatarUrl, email } });
  } catch (err) {
    logger.error(`[user-avatar generate] ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/users/avatars/bulk-generate — SSE stream; AI headshot for
// every user (skip those that already have one unless overwrite). Body: { overwrite? }.
router.post('/:slug/users/avatars/bulk-generate', async (req, res) => {
  const org = getOrg(req.params.slug);
  if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
  if (!env.OPENAI_API_KEY) return res.status(400).json({ success: false, error: 'No OpenAI API key configured' });

  const overwrite = !!req.body?.overwrite;
  const { provider, model, quality } = req.body || {};
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Stop generating (and stop spending) the moment the client disconnects.
  // NOTE: listen on `res`, not `req` — a buffered POST's `req` stream closes as
  // soon as the body is read, which would abort the loop after one image.
  let aborted = false;
  res.on('close', () => { aborted = true; });

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const targets = (org.users || []).filter((u) => overwrite || !u.avatarUrl);
  let working = org;
  let generated = 0;
  send({ type: 'start', total: targets.length });

  for (let i = 0; i < targets.length; i++) {
    if (aborted) break;
    const user = targets[i];
    send({ type: 'progress', email: user.email, index: i, total: targets.length, status: 'generating' });
    try {
      const avatarUrl = await generateAndSaveUserAvatar(req.params.slug, working, user, openai, { provider, model, quality });
      working = { ...working, users: (working.users || []).map((u) => (u.email === user.email ? { ...u, avatarUrl } : u)) };
      saveOrg(working); // persist incrementally so partial progress survives
      generated += 1;
      send({ type: 'progress', email: user.email, index: i, total: targets.length, status: 'done', avatarUrl });
    } catch (err) {
      send({ type: 'progress', email: user.email, index: i, total: targets.length, status: 'error', error: err.message });
    }
  }
  send({ type: 'done', generated, total: targets.length });
  res.end();
});

// POST /api/orgs/:slug/users/avatar/upload — manual avatar upload (field: avatar).
router.post('/:slug/users/avatar/upload', mediaUpload.single('avatar'), async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    const email = req.body.email;
    const user = (org.users || []).find((u) => u.email === email);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const buf = await sharp(req.file.buffer).resize(512, 512, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
    const key = userKey(email);
    fs.mkdirSync(userAvatarDir(req.params.slug), { recursive: true });
    fs.writeFileSync(userAvatarPath(req.params.slug, key), buf);

    const avatarUrl = userAvatarApiUrl(req.params.slug, key);
    const users = (org.users || []).map((u) => (u.email === email ? { ...u, avatarUrl } : u));
    saveOrg({ ...org, users });
    res.json({ success: true, data: { avatarUrl, email } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/orgs/:slug/users/avatar — remove a user's avatar. Body: { email }.
router.delete('/:slug/users/avatar', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    const { email } = req.body || {};
    const key = userKey(email);
    try { fs.unlinkSync(userAvatarPath(req.params.slug, key)); } catch { /* already gone */ }
    const users = (org.users || []).map((u) => {
      if (u.email !== email) return u;
      const { avatarUrl, ...rest } = u;
      return rest;
    });
    const updated = saveOrg({ ...org, users });
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

    const buf = await sharp(req.file.buffer).resize(1024, 1024, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer();
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
      comment = '',
    } = req.body;
    if (!categoryName || !itemName) return res.status(400).json({ success: false, error: 'categoryName and itemName required' });

    logger.info(`Generating image: ${org.slug} / ${itemName} [${provider} ${model} ${quality}]`);

    // GPT-4o builds the smart prompt (always uses OpenAI for this, regardless of image provider)
    const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
    let prompt;
    try {
      if (!openai) throw new Error('No OpenAI key for prompt generation');
      prompt = await buildSmartImagePrompt(openai, itemName, categoryName, notes, org, org.imageStyle, provider, comment);
      logger.info(`Smart prompt [${provider}]: ${prompt.slice(0, 120)}…`);
    } catch (promptErr) {
      logger.warn(`GPT-4o prompt failed, using static builder: ${promptErr.message}`);
      prompt = buildImagePrompt(itemName, categoryName, notes, org.industry, org.imageStyle, comment);
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
      size: '1024x1024',
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

  const { categoryName, mode = 'generate', provider = 'openai', model = 'gpt-image-1', quality = 'low', overwrite = false, comment = '' } = req.body;
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
          prompt = await buildSmartImagePrompt(promptOpenAI, item.name, categoryName, item.notes || item.itemInfo, org, org.imageStyle, provider, comment);
        } catch (promptErr) {
          logger.warn(`Smart prompt failed for "${item.name}", using fallback: ${promptErr.message}`);
          prompt = buildImagePrompt(item.name, categoryName, item.notes || item.itemInfo, org.industry, org.imageStyle, comment);
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

// GET /api/orgs/:slug/logo-sources — demo orgs (other than this one) whose logo
// can be imported here. Returns [{ slug, name, industry, variants }].
router.get('/:slug/logo-sources', (req, res) => {
  try {
    const self = req.params.slug;
    const sources = listOrgs()
      .filter((o) => o.slug !== self && o.source === 'demo')
      .map((o) => {
        let variants = [];
        try {
          variants = fs.readdirSync(orgLogoDir(o.slug)).filter((f) => f.endsWith('.png')).map((f) => f.replace('.png', ''));
        } catch { /* no logos */ }
        return { slug: o.slug, name: o.name, industry: o.industry, variants };
      })
      .filter((o) => o.variants.length > 0);
    res.json({ success: true, data: sources });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/import-logo — copy another org's logo variants into this
// org (e.g. pull a demo's "YOUR LOGO" placeholder). Body: { sourceSlug }.
router.post('/:slug/import-logo', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const { sourceSlug } = req.body || {};
    if (!sourceSlug) return res.status(400).json({ success: false, error: 'sourceSlug is required' });
    if (sourceSlug === org.slug) return res.status(400).json({ success: false, error: 'Cannot import a logo from the same org' });

    const srcDir = orgLogoDir(sourceSlug);
    if (!fs.existsSync(srcDir)) return res.status(404).json({ success: false, error: 'Source org has no logo to import' });

    fs.mkdirSync(orgLogoDir(org.slug), { recursive: true });
    fs.cpSync(srcDir, orgLogoDir(org.slug), { recursive: true });

    const variants = fs.readdirSync(orgLogoDir(org.slug)).filter((f) => f.endsWith('.png')).map((f) => f.replace('.png', ''));
    logger.info(`Imported logo: ${sourceSlug} → ${org.slug}`);
    res.json({ success: true, data: { variants } });
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

// POST /api/orgs/:slug/logo-placeholder — set a clean "YOUR LOGO" placeholder
// (instant, no AI). The default logo for demo orgs. (Path avoids colliding with
// the /:slug/logo/:variant route.)
router.post('/:slug/logo-placeholder', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    const png = await buildLogoPlaceholder(req.body?.label || 'YOUR LOGO');
    fs.mkdirSync(orgLogoDir(org.slug), { recursive: true });
    fs.writeFileSync(orgLogoPath(org.slug, 'color'), png);
    fs.writeFileSync(orgLogoPath(org.slug, 'default'), png);
    logger.info(`Logo placeholder set: ${org.slug}`);
    res.json({ success: true, data: { variants: ['color', 'default'], placeholder: true } });
  } catch (err) {
    logger.error(`Logo placeholder failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/generate-logo — AI-generate a fake logo for a demo org.
// (Path avoids colliding with the /:slug/logo/:variant route above.)
router.post('/:slug/generate-logo', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    // Default to Nano Banana Pro (Gemini) — strong at clean, transparent logos.
    const { provider = 'gemini', model = 'gemini-3-pro-image' } = req.body || {};
    const industry = org.industry || 'home services';
    const prompt = [
      `A clean, modern, professional logo emblem for a fictional ${industry} contractor company named "${org.name}".`,
      'Flat vector style, simple iconic mark, bold solid shapes, 2-3 brand colors, strong silhouette, square 1:1 composition.',
      'Centered on a plain, solid, pure white studio background.',
      'NO text, NO letters, NO words — icon/emblem only. No photorealism, no 3D, no drop shadows, no watermark.',
    ].join(' ');

    logger.info(`Generating AI logo: ${org.slug} [${provider} ${model}]`);
    const raw = await generateImage(prompt, { provider, model, quality: '2k' });

    // ML background removal → one clean, full-colour transparent logo.
    const color = await knockoutLogoBackground(raw);

    fs.mkdirSync(orgLogoDir(org.slug), { recursive: true });
    fs.writeFileSync(orgLogoPath(org.slug, 'color'), color);
    fs.writeFileSync(orgLogoPath(org.slug, 'default'), color);

    logger.info(`AI logo saved (color): ${org.slug}`);
    res.json({ success: true, data: { variants: ['color', 'default'], model: `${provider}:${model}` } });
  } catch (err) {
    logger.error(`AI logo generation failed: ${err.message}`);
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

    const validPositions = ['auto', 'bottom-left', 'bottom-right', 'top-left', 'top-right'];
    // Prefer the request body (live config from Settings), then the saved org
    // overlay config, then defaults.
    const savedOverlay = org.logoOverlay || {};
    const position = validPositions.includes(req.body?.position)
      ? req.body.position
      : (validPositions.includes(savedOverlay.position) ? savedOverlay.position : 'bottom-left');
    const backdrop = normalizeLogoBackdrop(
      req.body?.backdrop !== undefined ? req.body.backdrop : savedOverlay.backdrop
    );

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
          const { buffer: finalBuffer } = await composeLogo(imageBuffer, slug, logoVariants, position, backdrop);

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

// Credentials (apiUrl + apiKey) now arrive as `x-menaia-*` request headers and
// are resolved from the request context by the deployment service, so only the
// plan/confirm fields come from the body.
function deploymentOptions(body) {
  // Resolve via the per-request Menaia context (Settings-page headers, falling
  // back to .env) so the deploy targets the active org/key.
  // Two auth modes: SERVICE (default, service-account key) or USER (a real org
  // admin via Supabase JWT) — the latter to get around the service account's
  // missing `create Item` ability (Menaia migration gap). Signalled by
  // body.deployMode === 'user' + admin email/password.
  const credentials = body.deployMode === 'user'
    ? {
        email: body.adminEmail,
        password: body.adminPassword,
        organizationId: body.expectedOrganizationId,
        supabaseUrl: getSupabaseUrl(),
        anonKey: getSupabaseAnonKey(),
      }
    : { apiKey: getMenaiaApiKey() };
  return {
    apiUrl: getMenaiaApiUrl(),
    expectedOrganizationId: body.expectedOrganizationId,
    confirmation: body.confirmation,
    credentials,
  };
}

// SERVICE mode needs the Menaia key; USER mode needs the Menaia API URL +
// Supabase config (admin email/password come in the request body).
function validateDeploymentRequest(body) {
  try {
    if (body?.deployMode === 'user') {
      if (!getMenaiaApiUrl()) return 'Menaia API URL is required (Settings)';
      if (!getSupabaseUrl() || !getSupabaseAnonKey()) return 'Supabase URL + anon key are required for admin-user deploy (Settings → Demo Data)';
      if (!body.adminEmail || !body.adminPassword) return 'Admin email and password are required for admin-user deploy';
      return null;
    }
    validateMenaiaConfig();
    return null;
  } catch (err) {
    return err.message;
  }
}

// POST /api/orgs/:slug/deploy/plan — authenticate, resolve scoped org, and calculate a read-only plan
router.post('/:slug/deploy/plan', async (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
    const validationError = validateDeploymentRequest(req.body);
    if (validationError) return res.status(400).json({ success: false, error: validationError });

    logger.info(`Planning deployment for ${org.slug} to ${getMenaiaApiUrl()}`);
    const plan = await preflightOrgDeployment(org, deploymentOptions(req.body));
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/deploy — upsert into the single organization visible to
// the supplied admin. Streams each step live as Server-Sent Events so the UI can
// show progress ("running"/"done"/"failed") in real time. Pre-flight validation
// errors are still returned as plain JSON before the stream opens.
router.post('/:slug/deploy', async (req, res) => {
  const org = getOrg(req.params.slug);
  if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

  const validationError = validateDeploymentRequest(req.body);
  if (validationError) return res.status(400).json({ success: false, error: validationError });
  if (!req.body.expectedOrganizationId || !req.body.confirmation) {
    return res.status(400).json({ success: false, error: 'Run the deployment plan and confirm its target before deploying' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    logger.info(`Deploying org ${org.slug} to existing organization ${req.body.expectedOrganizationId} at ${getMenaiaApiUrl()}`);
    // Each step from deployOrg is forwarded as a `step` event; the final result
    // (with the full log + credentials) arrives as a `done` event.
    const result = await deployOrg(org, deploymentOptions(req.body), (entry) => send({ type: 'step', entry }));

    updateDeploymentLog(org.slug, result, {
      id: req.body.expectedOrganizationId,
      apiUrl: getMenaiaApiUrl(),
    });

    send({ type: 'done', result });
    res.end();
  } catch (err) {
    send({ type: 'done', result: { success: false, error: err.message, log: [], actions: [], credentials: [] } });
    res.end();
  }
});

// Pick the admin to authenticate as for the demo-data step. Prefers Super Admin
// / Admin (covers manage:User for avatars + BRANCH_MANAGEMENT for leads). Reads
// the credentials persisted from the last deploy, falling back to the draft's
// own users — their passwords are deterministic, so even when a re-deploy skips
// creation with a 409 (and records nothing) we can still resolve the admin login.
function resolveAdminCredentials(org) {
  // Mirror the deploy's password padding (API requires >= 8 chars).
  const pad = (p) => ((p || '').length >= 8 ? p : (p || 'Password').padEnd(8, '0'));
  const fromCreds = org?.deployment?.credentials || [];
  const fromDraft = (org?.users || []).map((u) => ({ email: u.email, password: pad(u.password), role: u.role }));
  const pickAdmin = (pool) => {
    const byRole = (re) => pool.find((c) => re.test(String(c.role || '')));
    return byRole(/super\s*admin/i) || byRole(/^admin$/i) || byRole(/admin/i) || byRole(/sales\s*admin/i) || null;
  };
  const admin = pickAdmin(fromCreds) || pickAdmin(fromDraft);
  return admin ? { email: admin.email, password: admin.password, role: admin.role } : null;
}

// Shared pre-flight for the demo-data endpoints: validate config + deploy state,
// resolve the admin login, and assemble the service options. Returns either
// `{ error }` (caller responds 400) or `{ options, admin }`.
function demoDataPreflight(org, req) {
  try { validateMenaiaConfig(); validateDemoDataConfig(); } catch (err) { return { error: err.message }; }
  if (!org.deployment?.lastDeployedAt) {
    return { error: 'Deploy the org before populating demo data' };
  }
  const admin = resolveAdminCredentials(org);
  if (!admin) {
    return { error: 'No admin credentials on file — re-deploy to capture them' };
  }
  return {
    admin,
    options: {
      apiUrl: getMenaiaApiUrl(),
      supabaseUrl: getSupabaseUrl(),
      anonKey: getSupabaseAnonKey(),
      payloadUrl: getPayloadUrl(),
      adminEmail: admin.email,
      adminPassword: admin.password,
      leadsPerBranch: Number(req.body?.leadsPerBranch) || 5,
      includeAvatars: req.body?.includeAvatars !== false,
      confirmation: req.body?.confirmation,
    },
  };
}

// POST /api/orgs/:slug/deploy/demo-data/plan — dry run. Authenticates as the org
// admin, resolves the live target org, and returns what a populate would create
// (avatars + leads per branch) plus a confirmation token. Read-only JSON.
router.post('/:slug/deploy/demo-data/plan', async (req, res) => {
  const org = getOrg(req.params.slug);
  if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
  const pre = demoDataPreflight(org, req);
  if (pre.error) return res.status(400).json({ success: false, error: pre.error });
  try {
    logger.info(`Planning demo data for ${org.slug} as ${pre.admin.email} (${pre.admin.role})`);
    const plan = await planDemoData(org, pre.options);
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/orgs/:slug/deploy/demo-data — post-deploy population. Authenticates
// as a real org admin (Supabase password grant) and seeds user avatars + N demo
// leads per branch via the Payload REST + NestJS avatar APIs (which the service
// key can't reach). Requires the confirmation token from the dry run. Streams
// progress as SSE, same shape as /deploy.
router.post('/:slug/deploy/demo-data', async (req, res) => {
  const org = getOrg(req.params.slug);
  if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
  const pre = demoDataPreflight(org, req);
  if (pre.error) return res.status(400).json({ success: false, error: pre.error });
  if (!pre.options.confirmation) {
    return res.status(400).json({ success: false, error: 'Run the dry run and confirm its target before populating' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    logger.info(`Populating demo data for ${org.slug} as ${pre.admin.email} (${pre.admin.role})`);
    const result = await seedDemoData(org, pre.options, (entry) => send({ type: 'step', entry }));
    send({ type: 'done', result });
    res.end();
  } catch (err) {
    send({ type: 'done', result: { success: false, error: err.message, log: [], actions: [] } });
    res.end();
  }
});

// GET /api/orgs/:slug/deploy/export — download an .xlsx of the users created on
// the last deploy (sheet 1) plus a deploy summary (sheet 2). Reads the persisted
// deployment log, so it works on any revisit after a successful deploy.
router.get('/:slug/deploy/export', (req, res) => {
  try {
    const org = getOrg(req.params.slug);
    if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

    const deployment = org.deployment;
    if (!deployment || !deployment.lastDeployedAt) {
      return res.status(400).json({ success: false, error: 'This org has not been deployed yet' });
    }

    const credentials = deployment.credentials || [];

    // Sheet 1 — created users (one row per credential).
    const userRows = credentials.map((c) => ({
      Name: c.name || '',
      Email: c.email || '',
      Password: c.password || '',
      Role: c.role || '',
      Branches: (c.branches || []).join(', '),
    }));
    const usersSheet = XLSX.utils.json_to_sheet(
      userRows.length ? userRows : [{ Name: '', Email: '', Password: '', Role: '', Branches: '' }]
    );

    // Sheet 2 — deploy summary: target + per-collection action counts.
    const actions = deployment.actions || [];
    const byCollection = {};
    for (const a of actions) {
      const key = a.collection || 'other';
      byCollection[key] = byCollection[key] || { created: 0, updated: 0 };
      if (a.operation === 'updated') byCollection[key].updated += 1;
      else byCollection[key].created += 1;
    }
    const summaryRows = [
      { Field: 'Organization', Value: org.name || org.slug },
      { Field: 'Slug', Value: org.slug },
      { Field: 'Status', Value: org.status || '' },
      { Field: 'Deployed at', Value: deployment.lastDeployedAt },
      { Field: 'Target org', Value: deployment.target?.name || '' },
      { Field: 'Target ID', Value: deployment.organizationId || '' },
      { Field: 'API URL', Value: deployment.target?.apiUrl || '' },
      { Field: 'Deployed by', Value: deployment.actor?.email || '' },
      { Field: 'Users created', Value: credentials.length },
      { Field: 'Total actions', Value: actions.length },
      { Field: '', Value: '' },
      { Field: 'Collection', Value: 'Created / Updated' },
      ...Object.entries(byCollection).map(([collection, counts]) => ({
        Field: collection,
        Value: `${counts.created} / ${counts.updated}`,
      })),
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { skipHeader: true });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, usersSheet, 'Users');
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const datePart = (deployment.lastDeployedAt || '').slice(0, 10);
    const filename = `${org.slug}-deploy-users${datePart ? `-${datePart}` : ''}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
