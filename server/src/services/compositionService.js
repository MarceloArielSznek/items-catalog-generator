import sharp from "sharp";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import env from "../config/env.js";
import logger from "../utils/logger.js";
import {
  COMPOSITION_DEFAULTS,
  LIGHTING_DEFAULTS,
  DEFAULT_LOGO_POSITION,
  OUTPUT_FORMATS,
  DEFAULT_FORMAT,
} from "../../../shared/constants/imageRules.js";

function calculatePosition(canvasW, canvasH, objW, objH, position, margin) {
  const positions = {
    "top-left":      { left: margin, top: margin },
    "top-center":    { left: Math.round((canvasW - objW) / 2), top: margin },
    "top-right":     { left: canvasW - objW - margin, top: margin },
    "middle-left":   { left: margin, top: Math.round((canvasH - objH) / 2) },
    "middle-center": { left: Math.round((canvasW - objW) / 2), top: Math.round((canvasH - objH) / 2) },
    "middle-right":  { left: canvasW - objW - margin, top: Math.round((canvasH - objH) / 2) },
    "bottom-left":   { left: margin, top: canvasH - objH - margin },
    "bottom-center": { left: Math.round((canvasW - objW) / 2), top: canvasH - objH - margin },
    "bottom-right":  { left: canvasW - objW - margin, top: canvasH - objH - margin },
  };
  return positions[position] || positions[DEFAULT_LOGO_POSITION];
}

async function prepareLogo(logoPath, canvasWidth, logoScale) {
  const scale = logoScale || COMPOSITION_DEFAULTS.logoScale;
  const maxLogoWidth = Math.round(canvasWidth * scale);
  const logoBuffer = await sharp(logoPath)
    .resize({ width: maxLogoWidth, withoutEnlargement: true })
    .toBuffer();
  const meta = await sharp(logoBuffer).metadata();
  return { buffer: logoBuffer, width: meta.width, height: meta.height };
}

async function createContactShadow(wrapWidth, wrapHeight, intensity = 1) {
  const opacity = COMPOSITION_DEFAULTS.contactShadowOpacity * intensity;
  const shadowW = Math.round(wrapWidth * 0.70);
  const shadowH = Math.round(wrapHeight * 0.12);

  if (shadowW < 2 || shadowH < 2) return null;

  const svg = `<svg width="${shadowW}" height="${shadowH}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="csg" cx="50%" cy="50%" r="75%">
        <stop offset="0%" stop-color="black" stop-opacity="${(0.6 * opacity).toFixed(3)}"/>
        <stop offset="66%" stop-color="black" stop-opacity="${(0.15 * opacity).toFixed(3)}"/>
        <stop offset="100%" stop-color="black" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <ellipse cx="${shadowW / 2}" cy="${shadowH / 2}" rx="${shadowW / 2}" ry="${shadowH / 2}" fill="url(#csg)"/>
  </svg>`;

  return { buffer: Buffer.from(svg), width: shadowW, height: shadowH };
}

async function createAmbientShadow(itemBuffer, itemWidth, itemHeight, intensity = 1) {
  const { ambientShadowBlur: baseBlur, ambientShadowOpacity: baseOpacity } = COMPOSITION_DEFAULTS;
  const spread = 1.04;
  const spreadW = Math.round(itemWidth * spread);
  const spreadH = Math.round(itemHeight * spread);
  const blur = Math.max(1, Math.round(baseBlur * 0.5 * intensity));
  const opacity = baseOpacity * 0.45 * intensity;

  const shadowBase = await sharp(itemBuffer)
    .resize(spreadW, spreadH, { fit: "fill" })
    .ensureAlpha()
    .modulate({ brightness: 0 })
    .blur(blur)
    .toBuffer();

  const maskSvg = `<svg width="${spreadW}" height="${spreadH}"><rect width="100%" height="100%" fill="rgba(0,0,0,${opacity.toFixed(3)})"/></svg>`;
  const shadow = await sharp(shadowBase)
    .composite([{ input: Buffer.from(maskSvg), blend: "dest-in" }])
    .png()
    .toBuffer();

  return { buffer: shadow, width: spreadW, height: spreadH };
}

export async function composeFullImage({ backgroundPath, transparentItemPath, itemScale, shadowIntensity }) {
  const scale = itemScale || COMPOSITION_DEFAULTS.itemScale;
  const shadow = shadowIntensity != null ? shadowIntensity : 1;
  logger.info("Full programmatic composition (enhanced, no logo)", { itemScale: scale, shadowIntensity: shadow });
  const start = Date.now();

  const bgMeta = await sharp(backgroundPath).metadata();
  const canvasW = bgMeta.width;
  const canvasH = bgMeta.height;

  const maxItemW = Math.round(canvasW * scale);
  const maxItemH = Math.round(canvasH * scale);
  const itemBuffer = await sharp(transparentItemPath)
    .resize({ width: maxItemW, height: maxItemH, fit: "inside" })
    .toBuffer();
  const itemMeta = await sharp(itemBuffer).metadata();

  const itemLeft = Math.round((canvasW - itemMeta.width) / 2);
  const itemTop = Math.round(canvasH * COMPOSITION_DEFAULTS.itemVerticalBias - itemMeta.height / 2);

  const layers = [];

  if (shadow > 0) {
    try {
      const ambient = await createAmbientShadow(itemBuffer, itemMeta.width, itemMeta.height, shadow);
      const ambLeft = itemLeft - Math.round((ambient.width - itemMeta.width) / 2);
      const ambTop = itemTop - Math.round((ambient.height - itemMeta.height) / 2) + COMPOSITION_DEFAULTS.ambientShadowOffsetY;
      layers.push({
        input: ambient.buffer,
        left: Math.max(0, ambLeft),
        top: Math.max(0, ambTop),
      });
    } catch {
      logger.warn("Ambient shadow failed, skipping");
    }

    try {
      const contact = await createContactShadow(maxItemW, maxItemH, shadow);
      if (contact) {
        const contactLeft = Math.round((canvasW - contact.width) / 2);
        const contactBottom = itemTop + itemMeta.height + Math.round(maxItemH * 0.04);
        const contactTop = contactBottom - contact.height;
        layers.push({
          input: contact.buffer,
          left: Math.max(0, contactLeft),
          top: Math.min(canvasH - contact.height, Math.max(0, contactTop)),
        });
      }
    } catch {
      logger.warn("Contact shadow failed, skipping");
    }
  }

  layers.push({ input: itemBuffer, left: itemLeft, top: Math.max(0, itemTop) });

  const outputFilename = `catalog-${uuidv4()}.png`;
  const outputPath = path.resolve(env.GENERATED_DIR, outputFilename);

  await sharp(backgroundPath)
    .composite(layers)
    .png()
    .toFile(outputPath);

  const elapsed = Date.now() - start;
  logger.info("Enhanced composition complete", { outputFilename, elapsed_ms: elapsed });

  return { outputFilename, outputPath };
}

export async function overlayLogo({ scenePath, logoPath, logoPosition = DEFAULT_LOGO_POSITION, logoScale }) {
  const sceneMeta = await sharp(scenePath).metadata();
  const logo = await prepareLogo(logoPath, sceneMeta.width, logoScale);
  const logoPos = calculatePosition(sceneMeta.width, sceneMeta.height, logo.width, logo.height, logoPosition, COMPOSITION_DEFAULTS.logoMargin);

  const outputFilename = `catalog-${uuidv4()}.png`;
  const outputPath = path.resolve(env.GENERATED_DIR, outputFilename);

  await sharp(scenePath)
    .composite([{ input: logo.buffer, left: logoPos.left, top: logoPos.top }])
    .png()
    .toFile(outputPath);

  logger.info("Logo overlay complete", { outputFilename, logoPosition });
  return { outputFilename, outputPath };
}

export async function composePreview({ backgroundPath, transparentItemPath, itemScale }) {
  const scale = itemScale || COMPOSITION_DEFAULTS.itemScale;
  const bgMeta = await sharp(backgroundPath).metadata();
  const canvasW = bgMeta.width;
  const canvasH = bgMeta.height;

  const maxItemW = Math.round(canvasW * scale);
  const maxItemH = Math.round(canvasH * scale);
  const itemBuffer = await sharp(transparentItemPath)
    .resize({ width: maxItemW, height: maxItemH, fit: "inside" })
    .toBuffer();
  const itemMeta = await sharp(itemBuffer).metadata();

  const itemLeft = Math.round((canvasW - itemMeta.width) / 2);
  const itemTop = Math.round(canvasH * COMPOSITION_DEFAULTS.itemVerticalBias - itemMeta.height / 2);

  const outputFilename = `precomp-${uuidv4()}.png`;
  const outputPath = path.resolve(env.GENERATED_DIR, outputFilename);

  await sharp(backgroundPath)
    .composite([{ input: itemBuffer, left: itemLeft, top: Math.max(0, itemTop) }])
    .png()
    .toFile(outputPath);

  logger.info("Pre-composition complete", { outputFilename });
  return { outputPath, outputFilename };
}

function applyLighting(pipeline, lighting) {
  const b = lighting.brightness ?? LIGHTING_DEFAULTS.brightness;
  const s = lighting.saturation ?? LIGHTING_DEFAULTS.saturation;
  const c = lighting.contrast ?? LIGHTING_DEFAULTS.contrast;
  const w = lighting.warmth ?? LIGHTING_DEFAULTS.warmth;

  pipeline = pipeline.modulate({ brightness: b, saturation: s });

  if (c !== 1) {
    pipeline = pipeline.linear(c, -(128 * (c - 1)));
  }

  if (w !== 0) {
    const r = 1 + w * 0.12;
    const g = 1 + w * 0.02;
    const bl = 1 - w * 0.12;
    pipeline = pipeline.recomb([
      [r, 0, 0],
      [0, g, 0],
      [0, 0, bl],
    ]);
  }

  return pipeline;
}

export async function processServiceImage({ imagePath, format, lighting, logoPath, logoPosition, logoScale }) {
  const start = Date.now();
  const spec = OUTPUT_FORMATS[format || DEFAULT_FORMAT];
  if (!spec) throw new Error(`Unknown format: ${format}`);

  logger.info("Processing service image", { format, lighting });

  let pipeline = sharp(imagePath)
    .resize(spec.width, spec.height, { fit: "cover", position: "centre" });

  if (lighting) {
    pipeline = applyLighting(pipeline, lighting);
  }

  const resizedFilename = `service-${uuidv4()}.png`;
  const resizedPath = path.resolve(env.GENERATED_DIR, resizedFilename);
  await pipeline.png().toFile(resizedPath);

  const final = await overlayLogo({ scenePath: resizedPath, logoPath, logoPosition, logoScale });

  const elapsed = Date.now() - start;
  logger.info("Service image complete", { outputFilename: final.outputFilename, elapsed_ms: elapsed });

  return { outputFilename: final.outputFilename, outputPath: final.outputPath, tempFiles: [resizedPath] };
}

export async function resizeToFormat(inputPath, format = DEFAULT_FORMAT) {
  const spec = OUTPUT_FORMATS[format];
  if (!spec) {
    logger.warn(`Unknown format "${format}", skipping resize`);
    return { outputPath: inputPath, outputFilename: path.basename(inputPath) };
  }

  const outputFilename = `final-${uuidv4()}.png`;
  const outputPath = path.resolve(env.GENERATED_DIR, outputFilename);

  await sharp(inputPath)
    .resize(spec.width, spec.height, { fit: "cover", position: "center" })
    .png()
    .toFile(outputPath);

  logger.info("Resized to format", { format, size: `${spec.width}x${spec.height}`, outputFilename });
  return { outputPath, outputFilename };
}
