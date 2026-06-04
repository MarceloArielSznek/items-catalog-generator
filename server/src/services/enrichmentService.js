import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import OpenAI from "openai";
import env from "../config/env.js";
import logger from "../utils/logger.js";
import { findBestImage, findImageCandidates, downloadImage } from "./imageSearchService.js";
import { getItem, updateItem, uploadMedia, attachMediaToItem, detachMediaFromItem, getCategories } from "./payloadService.js";
import { getRejectedImageUrls as getFeedbackRejections, getAllFeedback, getAcceptedSiblingUrls, normalizeItemBaseName } from "./feedbackService.js";
import { getOrgConfig } from "./orgConfigService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = path.resolve(__dirname, "../logos");
const BASE_IMAGES_DIR = path.resolve(__dirname, "../base-images");
const PRE_GENERATED_DIR = path.resolve(__dirname, "../pre-generated");
const LOGO_VARIANTS = ["white", "dark", "color", "default"];

// ── Pre-generated AI image storage (per org + item) ───────────────────────────

export async function savePreGeneratedImage(orgId, itemId, buffer) {
  const dir = path.join(PRE_GENERATED_DIR, `org-${orgId}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `item-${itemId}.jpg`), buffer);
}

export async function loadPreGeneratedImage(orgId, itemId) {
  try {
    return await fs.readFile(path.join(PRE_GENERATED_DIR, `org-${orgId}`, `item-${itemId}.jpg`));
  } catch {
    return null;
  }
}

export async function listPreGeneratedItemIds(orgId) {
  try {
    const files = await fs.readdir(path.join(PRE_GENERATED_DIR, `org-${orgId}`));
    return files.filter(f => f.startsWith("item-") && f.endsWith(".jpg"))
      .map(f => f.replace("item-", "").replace(".jpg", ""));
  } catch {
    return [];
  }
}

export async function deletePreGeneratedImage(orgId, itemId) {
  try {
    await fs.unlink(path.join(PRE_GENERATED_DIR, `org-${orgId}`, `item-${itemId}.jpg`));
  } catch { /* already gone */ }
}

// ── Base image storage (logo-free, for demo orgs) ─────────────────────────────

async function saveBaseImage(itemId, imageBuffer) {
  await fs.mkdir(BASE_IMAGES_DIR, { recursive: true });
  await fs.writeFile(path.join(BASE_IMAGES_DIR, `${itemId}.jpg`), imageBuffer);
  logger.info(`Base image saved: itemId=${itemId}`);
}

export async function loadBaseImage(itemId) {
  try {
    return await fs.readFile(path.join(BASE_IMAGES_DIR, `${itemId}.jpg`));
  } catch {
    return null;
  }
}

export async function listBaseImageItemIds() {
  try {
    const files = await fs.readdir(BASE_IMAGES_DIR);
    return files.filter(f => f.endsWith(".jpg")).map(f => f.replace(".jpg", ""));
  } catch {
    return [];
  }
}

// ── Logo storage ──────────────────────────────────────────────────────────────

async function ensureOrgLogoDir(orgId) {
  const dir = path.join(LOGOS_DIR, `org-${orgId}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function logoPath(orgId, variant = "default") {
  return path.join(LOGOS_DIR, `org-${orgId}`, `${variant}.png`);
}

/** Remove near-white bg and save as transparent PNG */
async function processLogoBuffer(buffer) {
  return sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      const { width, height, channels } = info;
      for (let i = 0; i < data.length; i += channels) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 240 && g > 240 && b > 240) data[i + 3] = 0;
      }
      return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
    });
}

export async function saveLogo(orgId, buffer, variant = "default") {
  await ensureOrgLogoDir(orgId);
  const png = await processLogoBuffer(buffer);
  await fs.writeFile(logoPath(orgId, variant), png);
  logger.info(`Logo saved: org=${orgId} variant=${variant}`);
}

export async function getLogo(orgId, variant = "default") {
  try { return await fs.readFile(logoPath(orgId, variant)); }
  catch { return null; }
}

export async function getLogoVariants(orgId) {
  const dir = path.join(LOGOS_DIR, `org-${orgId}`);
  try {
    const files = await fs.readdir(dir);
    const variants = [];
    for (const file of files) {
      if (!file.endsWith(".png")) continue;
      const variant = file.replace(".png", "");
      variants.push({ variant, path: path.join(dir, file) });
    }
    return variants;
  } catch { return []; }
}

export async function deleteLogo(orgId, variant) {
  try { await fs.unlink(logoPath(orgId, variant)); }
  catch { /* already gone */ }
}

export async function hasLogo(orgId) {
  const variants = await getLogoVariants(orgId);
  return variants.length > 0;
}

/**
 * Auto-select best logo variant based on zone brightness (0–255).
 * dark zone  → white logo
 * light zone → dark logo
 * neutral    → color logo
 * Falls back to any available variant.
 */
export async function selectBestLogoVariant(orgId, zoneBrightness) {
  const variants = await getLogoVariants(orgId);
  if (variants.length === 0) return null;

  const names = variants.map((v) => v.variant);

  let preferred;
  if (zoneBrightness < 90)       preferred = ["white", "color", "default", "dark"];
  else if (zoneBrightness < 160) preferred = ["color", "white", "default", "dark"];
  else                           preferred = ["dark",  "color", "default", "white"];

  for (const p of preferred) {
    if (names.includes(p)) {
      logger.info(`Logo variant selected: ${p} (brightness=${zoneBrightness.toFixed(0)})`);
      return p;
    }
  }
  return names[0]; // fallback to first available
}

// ── Description generation ────────────────────────────────────────────────────

export async function generateDescription(itemName, categoryName, unit) {
  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const prompt = `Write exactly 5 bullet points for a home services item called "${itemName}" (category: ${categoryName}).

Each bullet point should be one concise sentence covering:
1. What the item/service is
2. Why it's needed or what problem it solves
3. How it's installed or what the work involves
4. A key benefit or result
5. A practical tip or consideration for the homeowner

Format: markdown bullet list only (- bullet). No title, no intro, no extra text. Just the 5 bullets.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 250,
    temperature: 0.7,
  });

  return response.choices[0].message.content.trim();
}

// ── Contrast analysis → best logo position ───────────────────────────────────

/**
 * Analyzes the 4 corners of an image and returns the position
 * with the highest contrast against the estimated logo color (white by default).
 *
 * Returns one of: "top-left" | "top-right" | "bottom-left" | "bottom-right"
 */
export async function detectBestLogoPosition(imageBuffer) {
  const img = sharp(imageBuffer);
  const { width, height } = await img.metadata();

  if (!width || !height) return "bottom-right";

  const zoneSize = Math.min(Math.round(width * 0.3), Math.round(height * 0.3));

  const zones = [
    { name: "top-left",     left: 0,               top: 0 },
    { name: "top-right",    left: width - zoneSize, top: 0 },
    { name: "bottom-left",  left: 0,               top: height - zoneSize },
    { name: "bottom-right", left: width - zoneSize, top: height - zoneSize },
  ];

  const results = await Promise.all(
    zones.map(async (zone) => {
      try {
        const { data } = await sharp(imageBuffer)
          .extract({ left: zone.left, top: zone.top, width: zoneSize, height: zoneSize })
          .resize(12, 12, { fit: "fill" })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });

        let r = 0, g = 0, b = 0;
        const pixels = data.length / 3;
        for (let i = 0; i < data.length; i += 3) {
          r += data[i]; g += data[i + 1]; b += data[i + 2];
        }
        const brightness = (r + g + b) / (3 * pixels); // 0-255
        return { ...zone, brightness };
      } catch {
        return { ...zone, brightness: 128 };
      }
    })
  );

  // For a white/light logo → pick the darkest zone
  results.sort((a, b) => a.brightness - b.brightness);
  const best = results[0];
  logger.info(`Best logo position: ${best.name} (brightness: ${best.brightness.toFixed(0)})`);
  return best.name;
}

// ── Logo composition ──────────────────────────────────────────────────────────

export async function applyLogoToImage(imageBuffer, logoBuffer, position, forceInvert = null) {
  const img = sharp(imageBuffer);
  const { width, height } = await img.metadata();

  // Logo max width = 30% of image
  const maxLogoW = Math.round(width * 0.30);
  const resizedLogo = await sharp(logoBuffer)
    .resize({ width: maxLogoW, withoutEnlargement: true })
    .png()
    .toBuffer();

  const logoMeta = await sharp(resizedLogo).metadata();
  const logoW = logoMeta.width;
  const logoH = logoMeta.height;

  const margin = Math.round(width * 0.05);

  const positions = {
    "top-left":     { left: margin, top: margin },
    "top-right":    { left: width - logoW - margin, top: margin },
    "bottom-left":  { left: margin, top: height - logoH - margin },
    "bottom-right": { left: width - logoW - margin, top: height - logoH - margin },
  };

  const pos = positions[position] || positions["bottom-right"];

  // Sample brightness of the zone where logo will go
  const sampleSize = Math.min(logoW, logoH, 80);
  const { data: sampleData } = await sharp(imageBuffer)
    .extract({
      left: Math.max(0, Math.min(pos.left, width - sampleSize)),
      top: Math.max(0, Math.min(pos.top, height - sampleSize)),
      width: sampleSize,
      height: sampleSize,
    })
    .resize(8, 8)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let r = 0, g = 0, b = 0;
  const px = sampleData.length / 3;
  for (let i = 0; i < sampleData.length; i += 3) {
    r += sampleData[i]; g += sampleData[i + 1]; b += sampleData[i + 2];
  }
  const zoneBrightness = (r + g + b) / (3 * px);
  // forceInvert: true = negate, false = keep, null = auto
  const isLightBackground = zoneBrightness > 140;
  const shouldInvert = forceInvert !== null ? forceInvert : isLightBackground;

  let finalLogo = resizedLogo;
  if (shouldInvert) {
    finalLogo = await sharp(resizedLogo).negate({ alpha: false }).toBuffer();
  }

  logger.info(`Logo: brightness=${zoneBrightness.toFixed(0)}, invert=${shouldInvert}, position=${position}`);

  return sharp(imageBuffer)
    .composite([{ input: finalLogo, top: pos.top, left: pos.left }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// ── Main enrichment orchestrator ──────────────────────────────────────────────

/**
 * Enriches a Payload item:
 *   1. Generates AI description
 *   2. Finds best stock image via Google + Vision scoring
 *   3. Downloads image
 *   4. If org has logo → detects best position → composites logo
 *   5. Uploads final image to Payload
 *   6. Saves description to Payload
 *
 * @param {string|number} itemId  - Payload item ID
 * @param {string|number} orgId        - Organization ID (for logo lookup)
 * @param {Function}      onProgress   - Called with { step, message } for SSE streaming
 * @param {string}        industryContext - Optional industry hint for image search
 */
export async function enrichItem(itemId, orgId, onProgress = () => {}, industryContext = "") {

  onProgress({ step: "load", message: "Loading item data…" });
  const itemRes = await getItem(itemId);
  const item = itemRes.data || itemRes;
  const itemName = item.name || `Item ${itemId}`;
  const categoryName = item.category?.title || item.category?.name || "";
  const unit = item.unit || "";

  // ── Step 1: Description ──
  onProgress({ step: "description", message: "Generating description…" });
  const description = await generateDescription(itemName, categoryName, unit);
  logger.info(`Description generated for "${itemName}"`);

  // ── Step 2: Find image ──
  onProgress({ step: "search", message: "Searching for best image…" });
  const bestImage = await findBestImage(itemName, categoryName, industryContext);

  onProgress({ step: "download", message: `Downloading image from ${bestImage.domain}…` });
  let imageBuffer = await downloadImage(bestImage.url);

  // Normalize: convert to JPEG 1200px wide
  imageBuffer = await sharp(imageBuffer)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();

  // ── Step 3: Logo ──
  const logoVariants = orgId ? await getLogoVariants(orgId) : [];
  let finalImageBuffer = imageBuffer;

  if (logoVariants.length > 0) {
    onProgress({ step: "logo", message: "Selecting best logo and placement…" });
    const position = await detectBestLogoPosition(imageBuffer);

    // Get brightness at logo zone to pick variant
    const { width, height } = await sharp(imageBuffer).metadata();
    const margin = Math.round(width * 0.05);
    const zoneSize = Math.round(width * 0.3);
    const posMap = {
      "top-left": { left: margin, top: margin },
      "top-right": { left: width - zoneSize - margin, top: margin },
      "bottom-left": { left: margin, top: height - zoneSize - margin },
      "bottom-right": { left: width - zoneSize - margin, top: height - zoneSize - margin },
    };
    const zone = posMap[position] || posMap["bottom-right"];
    const { data: sd } = await sharp(imageBuffer)
      .extract({ left: Math.max(0, zone.left), top: Math.max(0, zone.top), width: zoneSize, height: zoneSize })
      .resize(8, 8).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let rr = 0, gg = 0, bb = 0;
    for (let i = 0; i < sd.length; i += 3) { rr += sd[i]; gg += sd[i+1]; bb += sd[i+2]; }
    const brightness = (rr + gg + bb) / (3 * (sd.length / 3));

    const bestVariant = await selectBestLogoVariant(orgId, brightness);
    const logoBuffer = bestVariant ? await getLogo(orgId, bestVariant) : null;

    if (logoBuffer) {
      finalImageBuffer = await applyLogoToImage(imageBuffer, logoBuffer, position);
      logger.info(`Logo applied: variant=${bestVariant}, position=${position}`);
    }
  } else {
    logger.info("No logos found for org, skipping logo placement");
  }

  // ── Step 4: Remove existing images then upload new one ──
  onProgress({ step: "upload", message: "Replacing existing images…" });
  const existingMedia = Array.isArray(item.media)
    ? item.media
    : item.media ? [item.media] : [];

  for (const m of existingMedia) {
    const mediaId = typeof m === "object" ? m.id : m;
    if (mediaId) {
      await detachMediaFromItem(itemId, mediaId).catch(() => {});
    }
  }

  const filename = `${itemName.replace(/\s+/g, "-").toLowerCase()}-enriched.jpg`;
  const mediaDoc = await uploadMedia(finalImageBuffer, filename, "image/jpeg");
  if (mediaDoc?.id) {
    await attachMediaToItem(itemId, mediaDoc.id);
  }

  // ── Step 5: Save description ──
  onProgress({ step: "save", message: "Saving description…" });
  await updateItem(itemId, { itemInfo: description });

  onProgress({ step: "done", message: "Done!" });

  return {
    itemName,
    description,
    imageUrl: bestImage.url,
    imageDomain: bestImage.domain,
    logoApplied: !!logoBuffer,
  };
}

// ── Wizard: get candidates + description (no upload) ─────────────────────────

// ── Helper: get rejected image URLs for this item ────────────────────────────
// (delegates to feedbackService)
async function getRejectedImageUrls(itemId, orgId) {
  if (!orgId) return new Set();
  return getFeedbackRejections(itemId, orgId);
}

export async function getEnrichCandidates(itemId, orgId, industryContext = "", { skipWebSearch = false } = {}) {
  const itemRes = await getItem(itemId);
  const item = itemRes.data || itemRes;
  const itemName = item.name || `Item ${itemId}`;
  const categoryName = item.category?.title || item.category?.name || "";
  const unit = item.unit || "";

  // Get rejected URLs so we don't repeat them AND use as negative examples for ML
  const rejectedUrls = await getRejectedImageUrls(itemId, orgId);
  // Also exclude URLs already accepted for sibling items (same service, different size/BTU)
  const siblingAcceptedUrls = await getAcceptedSiblingUrls(itemId, itemName, orgId);
  const excludedUrls = new Set([...rejectedUrls, ...siblingAcceptedUrls]);

  const badExamples = Array.from(rejectedUrls).slice(0, 3);

  const [description, candidates] = await Promise.all([
    generateDescription(itemName, categoryName, unit),
    skipWebSearch
      ? Promise.resolve([])
      : findImageCandidates(itemName, categoryName, industryContext, 8, badExamples),
  ]);

  // Filter out already-rejected images and sibling-accepted images
  const filteredCandidates = candidates.filter((c) => !excludedUrls.has(c.url));

  const logoVariants = orgId ? await getLogoVariants(orgId) : [];

  // Check for a pre-generated AI image for this item — serve via /pre-generated route
  const preGenCandidates = [];
  if (orgId) {
    const preGenBuf = await loadPreGeneratedImage(orgId, itemId);
    if (preGenBuf) {
      const preGenUrl = `/pre-generated/org-${orgId}/item-${itemId}.jpg`;
      preGenCandidates.push({ url: preGenUrl, thumbUrl: preGenUrl, domain: "ai-generated", score: 10, isAI: true });
    }
  }

  return {
    itemId,
    itemName,
    categoryName,
    description,
    candidates: [
      ...preGenCandidates,
      ...filteredCandidates.slice(0, preGenCandidates.length > 0 ? 5 : 6).map((c) => ({
        url: c.url,
        thumbUrl: c.thumbUrl,
        domain: c.domain,
        score: c.totalScore,
      })),
    ],
    hasLogo: logoVariants.length > 0,
    logoVariants: logoVariants.map((v) => v.variant),
  };
}

// ── Wizard: apply selected image + lighting + logo → upload ──────────────────

export async function applyEnrich(itemId, orgId, {
  imageUrl,
  description,
  lighting = {},
  logoPosition = null,
  logoScale = 0.25,
  logoVariant = null,   // null = auto-select
  thumbUrlFallback = null,
}) {
  const itemRes = await getItem(itemId);
  const item = itemRes.data || itemRes;
  const itemName = item.name || `Item ${itemId}`;

  // Download selected image (with fallback to thumbUrl if main URL fails)
  let imageBuffer = await downloadImage(imageUrl, thumbUrlFallback);

  // Normalize to square 1080×1080 (crop center) — matches proposal display format
  imageBuffer = await sharp(imageBuffer)
    .resize(1080, 1080, { fit: "cover", position: "centre" })
    .jpeg({ quality: 88 })
    .toBuffer();

  // Apply lighting adjustments
  const brightness = lighting.brightness ?? 1;
  const contrast   = lighting.contrast   ?? 1;
  const saturation = lighting.saturation ?? 1;
  const warmth     = lighting.warmth     ?? 0;

  let adjusted = sharp(imageBuffer)
    .modulate({ brightness, saturation });

  // Contrast via linear
  if (contrast !== 1) {
    const a = contrast;
    const b = 128 * (1 - contrast);
    adjusted = adjusted.linear(a, b);
  }

  // Warmth: shift hue slightly
  if (warmth !== 0) {
    adjusted = adjusted.tint(warmth > 0
      ? { r: 255, g: 220, b: 180 }   // warm
      : { r: 180, g: 210, b: 255 }); // cool
  }

  imageBuffer = await adjusted.jpeg({ quality: 88 }).toBuffer();

  // Demo org: persist base image (no logo) for later reuse
  const orgCfg = orgId ? await getOrgConfig(orgId) : null;
  if (orgCfg?.isDemoOrg) await saveBaseImage(itemId, imageBuffer);

  // Apply logo — use specified variant or auto-select
  let logoBuffer = null;
  if (orgId && logoPosition) {
    if (logoVariant) {
      logoBuffer = await getLogo(orgId, logoVariant);
    } else {
      // Auto-select based on brightness at logo zone
      const { width, height } = await sharp(imageBuffer).metadata();
      const margin = Math.round(width * 0.08);
      const sampleSize = Math.min(120, Math.round(width * 0.25));
      const positions = {
        "top-left": { left: margin, top: margin },
        "top-right": { left: width - sampleSize - margin, top: margin },
        "bottom-left": { left: margin, top: height - sampleSize - margin },
        "bottom-right": { left: width - sampleSize - margin, top: height - sampleSize - margin },
      };
      const zone = positions[logoPosition] || positions["bottom-right"];
      const { data: sd } = await sharp(imageBuffer)
        .extract({ left: Math.max(0, zone.left), top: Math.max(0, zone.top), width: sampleSize, height: sampleSize })
        .resize(8, 8).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let rr = 0, gg = 0, bb = 0;
      for (let i = 0; i < sd.length; i += 3) { rr += sd[i]; gg += sd[i+1]; bb += sd[i+2]; }
      const bright = (rr + gg + bb) / (3 * (sd.length / 3));
      const bestVariant = await selectBestLogoVariant(orgId, bright);
      if (bestVariant) logoBuffer = await getLogo(orgId, bestVariant);
    }
  }

  if (logoBuffer && logoPosition) {
    const { width } = await sharp(imageBuffer).metadata();
    const maxLogoW = Math.round(width * (logoScale || 0.25));

    const resizedLogo = await sharp(logoBuffer)
      .resize({ width: maxLogoW, withoutEnlargement: true })
      .png()
      .toBuffer();

    const logoMeta = await sharp(resizedLogo).metadata();
    const logoW = logoMeta.width;
    const logoH = logoMeta.height;
    const { height } = await sharp(imageBuffer).metadata();
    const margin = Math.round(width * 0.08);

    const positions = {
      "top-left":      { left: margin,             top: margin },
      "top-center":    { left: Math.round((width - logoW) / 2), top: margin },
      "top-right":     { left: width - logoW - margin, top: margin },
      "middle-left":   { left: margin,             top: Math.round((height - logoH) / 2) },
      "middle-center": { left: Math.round((width - logoW) / 2), top: Math.round((height - logoH) / 2) },
      "middle-right":  { left: width - logoW - margin, top: Math.round((height - logoH) / 2) },
      "bottom-left":   { left: margin,             top: height - logoH - margin },
      "bottom-center": { left: Math.round((width - logoW) / 2), top: height - logoH - margin },
      "bottom-right":  { left: width - logoW - margin, top: height - logoH - margin },
    };

    const pos = positions[logoPosition] || positions["bottom-right"];

    // Auto-color: detect brightness at logo zone, invert logo if needed
    const sampleSize = Math.min(logoW, logoH, 80);
    const { data: sd } = await sharp(imageBuffer)
      .extract({ left: Math.max(0, pos.left), top: Math.max(0, pos.top), width: sampleSize, height: sampleSize })
      .resize(8, 8).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let rr = 0, gg = 0, bb = 0;
    for (let i = 0; i < sd.length; i += 3) { rr += sd[i]; gg += sd[i+1]; bb += sd[i+2]; }
    const bright = (rr + gg + bb) / (3 * (sd.length / 3));

    let finalLogo = resizedLogo;
    if (bright > 140) {
      finalLogo = await sharp(resizedLogo).negate({ alpha: false }).toBuffer();
    }

    imageBuffer = await sharp(imageBuffer)
      .composite([{ input: finalLogo, top: pos.top, left: pos.left }])
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  // Remove existing media
  const existingMedia = Array.isArray(item.media)
    ? item.media : item.media ? [item.media] : [];
  for (const m of existingMedia) {
    const mid = typeof m === "object" ? m.id : m;
    if (mid) await detachMediaFromItem(itemId, mid).catch(() => {});
  }

  // Upload
  const filename = `${itemName.replace(/\s+/g, "-").toLowerCase()}-enriched.jpg`;
  const mediaDoc = await uploadMedia(imageBuffer, filename, "image/jpeg");
  if (mediaDoc?.id) await attachMediaToItem(itemId, mediaDoc.id);

  // Save description
  if (description) await updateItem(itemId, { itemInfo: description });

  return { success: true, itemName, mediaId: mediaDoc?.id };
}


// ── Bulk apply logo to previously saved base images ───────────────────────────

export async function bulkApplyLogo(orgId, itemIds) {
  const succeeded = [];
  const failed = [];

  for (const itemId of itemIds) {
    try {
      const baseBuffer = await loadBaseImage(itemId);
      if (!baseBuffer) throw new Error("No base image found");

      const itemRes = await getItem(itemId);
      const item = itemRes.data || itemRes;
      const itemName = item.name || `Item ${itemId}`;

      const logoVariants = await getLogoVariants(orgId);
      if (logoVariants.length === 0) throw new Error("No logo for org");

      // Auto-detect best logo position and variant using bottom-right as default
      const { width, height } = await sharp(baseBuffer).metadata();
      const margin = Math.round(width * 0.04);
      const sampleSize = Math.min(120, Math.round(width * 0.25));
      const zone = { left: width - sampleSize - margin, top: height - sampleSize - margin };
      const { data: sd } = await sharp(baseBuffer)
        .extract({ left: Math.max(0, zone.left), top: Math.max(0, zone.top), width: sampleSize, height: sampleSize })
        .resize(8, 8).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let rr = 0, gg = 0, bb = 0;
      for (let i = 0; i < sd.length; i += 3) { rr += sd[i]; gg += sd[i + 1]; bb += sd[i + 2]; }
      const bright = (rr + gg + bb) / (3 * (sd.length / 3));

      const bestVariant = await selectBestLogoVariant(orgId, bright);
      const logoBuffer = bestVariant ? await getLogo(orgId, bestVariant) : null;
      if (!logoBuffer) throw new Error("Could not load logo buffer");

      const logoPosition = "bottom-right";
      const logoScale = 0.25;
      const maxLogoW = Math.round(width * logoScale);
      const resizedLogo = await sharp(logoBuffer)
        .resize({ width: maxLogoW, withoutEnlargement: true }).png().toBuffer();
      const logoMeta = await sharp(resizedLogo).metadata();
      const logoW = logoMeta.width;
      const logoH = logoMeta.height;

      const pos = { left: width - logoW - margin, top: height - logoH - margin };
      let finalLogo = resizedLogo;
      if (bright > 140) finalLogo = await sharp(resizedLogo).negate({ alpha: false }).toBuffer();

      const finalBuffer = await sharp(baseBuffer)
        .composite([{ input: finalLogo, top: pos.top, left: pos.left }])
        .jpeg({ quality: 90 })
        .toBuffer();

      // Replace media on item
      const existingMedia = Array.isArray(item.media)
        ? item.media : item.media ? [item.media] : [];
      for (const m of existingMedia) {
        const mid = typeof m === "object" ? m.id : m;
        if (mid) await detachMediaFromItem(itemId, mid).catch(() => {});
      }

      const filename = `${itemName.replace(/\s+/g, "-").toLowerCase()}-enriched.jpg`;
      const mediaDoc = await uploadMedia(finalBuffer, filename, "image/jpeg");
      if (mediaDoc?.id) await attachMediaToItem(itemId, mediaDoc.id);

      logger.info(`bulkApplyLogo: ✓ itemId=${itemId} (${itemName})`);
      succeeded.push({ itemId });
    } catch (err) {
      logger.warn(`bulkApplyLogo: ✗ itemId=${itemId}: ${err.message}`);
      failed.push({ itemId, error: err.message });
    }
  }

  return { succeeded, failed };
}

// ── Training: get random unreviewed items for training wizard ─────────────────

export async function getItemsForTraining(orgId, count = 10) {
  // 1. Get all categories for this org
  const categories = await getCategories(orgId);
  if (!categories || categories.length === 0) {
    throw new Error("No categories found for this organization");
  }

  // 2. Get all items across all categories (sample up to 5 items per cat)
  const { getItemsByCategory } = await import("./payloadService.js");
  const allItems = [];

  for (const cat of categories) {
    try {
      const items = await getItemsByCategory(cat.id);
      const sample = items.slice(0, 5).map((item) => ({
        id: item.id,
        name: item.name || `Item ${item.id}`,
        categoryId: cat.id,
        categoryName: cat.title || cat.name || "Uncategorized",
      }));
      allItems.push(...sample);
    } catch { /* skip categories with issues */ }
  }

  if (allItems.length === 0) throw new Error("No items found for training");

  // 3. Deduplicate by base name — only one item per family of similar names
  //    (e.g. "Mini Split 9000 BTU" and "Mini Split 18000 BTU" → keep one)
  const seenBaseNames = new Set();
  const dedupedItems = allItems.filter((item) => {
    const base = normalizeItemBaseName(item.name);
    if (seenBaseNames.has(base)) return false;
    seenBaseNames.add(base);
    return true;
  });

  // 4. Prioritize items that haven't been reviewed yet
  const allFeedback = await getAllFeedback();
  const reviewedItemIds = new Set(
    allFeedback.filter((f) => String(f.orgId) === String(orgId)).map((f) => String(f.itemId))
  );

  const unreviewed = dedupedItems.filter((item) => !reviewedItemIds.has(String(item.id)));
  const reviewed = dedupedItems.filter((item) => reviewedItemIds.has(String(item.id)));

  // Shuffle both pools
  const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);
  const pool = [...shuffle(unreviewed), ...shuffle(reviewed)];

  logger.info(`Training pool: ${unreviewed.length} unreviewed, ${reviewed.length} reviewed — picking ${count}`);

  return pool.slice(0, count);
}
