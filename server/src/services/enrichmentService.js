import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import OpenAI from "openai";
import env from "../config/env.js";
import logger from "../utils/logger.js";
import { findBestImage, findImageCandidates, downloadImage } from "./imageSearchService.js";
import { getItem, updateItem, uploadMedia, attachMediaToItem, detachMediaFromItem } from "./payloadService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGOS_DIR = path.resolve(__dirname, "../logos");
const LOGO_VARIANTS = ["white", "dark", "color", "default"];

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

export async function getEnrichCandidates(itemId, orgId, industryContext = "") {
  const itemRes = await getItem(itemId);
  const item = itemRes.data || itemRes;
  const itemName = item.name || `Item ${itemId}`;
  const categoryName = item.category?.title || item.category?.name || "";
  const unit = item.unit || "";

  const [description, candidates] = await Promise.all([
    generateDescription(itemName, categoryName, unit),
    findImageCandidates(itemName, categoryName, industryContext, 6),
  ]);

  const logoVariants = orgId ? await getLogoVariants(orgId) : [];

  return {
    itemId,
    itemName,
    categoryName,
    description,
    candidates: candidates.map((c) => ({
      url: c.url,
      thumbUrl: c.thumbUrl,
      domain: c.domain,
      score: c.totalScore,
    })),
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
}) {
  const itemRes = await getItem(itemId);
  const item = itemRes.data || itemRes;
  const itemName = item.name || `Item ${itemId}`;

  // Download selected image
  let imageBuffer = await downloadImage(imageUrl);

  // Normalize size
  imageBuffer = await sharp(imageBuffer)
    .resize({ width: 1200, withoutEnlargement: true })
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

  // Apply logo — use specified variant or auto-select
  let logoBuffer = null;
  if (orgId && logoPosition) {
    if (logoVariant) {
      logoBuffer = await getLogo(orgId, logoVariant);
    } else {
      // Auto-select based on brightness at logo zone
      const { width, height } = await sharp(imageBuffer).metadata();
      const margin = Math.round(width * 0.04);
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
    const margin = Math.round(width * 0.04);

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
