import sharp from "sharp";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import env from "../config/env.js";
import logger from "../utils/logger.js";
import {
  COMPOSITION_DEFAULTS,
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

async function prepareLogo(logoPath, canvasWidth) {
  const maxLogoWidth = Math.round(canvasWidth * COMPOSITION_DEFAULTS.logoScale);
  const logoBuffer = await sharp(logoPath)
    .resize({ width: maxLogoWidth, withoutEnlargement: true })
    .toBuffer();
  const meta = await sharp(logoBuffer).metadata();
  return { buffer: logoBuffer, width: meta.width, height: meta.height };
}

async function createContactShadow(itemWidth, canvasWidth, canvasHeight) {
  const shadowH = Math.round(canvasHeight * COMPOSITION_DEFAULTS.contactShadowHeight);
  const shadowW = Math.round(itemWidth * 0.85);
  const opacity = COMPOSITION_DEFAULTS.contactShadowOpacity;

  const svg = `<svg width="${shadowW}" height="${shadowH}">
    <defs>
      <radialEllipse id="cs" cx="50%" cy="40%" rx="50%" ry="50%"/>
      <radialGradient id="csg" cx="50%" cy="40%" rx="50%" ry="50%">
        <stop offset="0%" stop-color="rgba(0,0,0,${opacity})"/>
        <stop offset="70%" stop-color="rgba(0,0,0,${opacity * 0.3})"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
      </radialGradient>
    </defs>
    <ellipse cx="${shadowW / 2}" cy="${shadowH / 2}" rx="${shadowW / 2}" ry="${shadowH / 2}" fill="url(#csg)"/>
  </svg>`;

  return { buffer: Buffer.from(svg), width: shadowW, height: shadowH };
}

async function createAmbientShadow(itemBuffer, itemWidth, itemHeight) {
  const { ambientShadowBlur, ambientShadowOpacity, ambientShadowSpread } = COMPOSITION_DEFAULTS;
  const spreadW = Math.round(itemWidth * ambientShadowSpread);
  const spreadH = Math.round(itemHeight * ambientShadowSpread);

  const shadowBase = await sharp(itemBuffer)
    .resize(spreadW, spreadH, { fit: "fill" })
    .ensureAlpha()
    .modulate({ brightness: 0 })
    .blur(ambientShadowBlur)
    .toBuffer();

  const maskSvg = `<svg width="${spreadW}" height="${spreadH}">
    <rect width="100%" height="100%" fill="rgba(0,0,0,${ambientShadowOpacity})"/>
  </svg>`;

  const shadow = await sharp(shadowBase)
    .composite([{ input: Buffer.from(maskSvg), blend: "dest-in" }])
    .toBuffer();

  return { buffer: shadow, width: spreadW, height: spreadH };
}

export async function composeFullImage({ backgroundPath, transparentItemPath }) {
  logger.info("Full programmatic composition (enhanced, no logo)");
  const start = Date.now();

  const bgMeta = await sharp(backgroundPath).metadata();
  const canvasW = bgMeta.width;
  const canvasH = bgMeta.height;

  const maxItemW = Math.round(canvasW * COMPOSITION_DEFAULTS.itemScale);
  const maxItemH = Math.round(canvasH * COMPOSITION_DEFAULTS.itemScale);
  const itemBuffer = await sharp(transparentItemPath)
    .resize({ width: maxItemW, height: maxItemH, fit: "inside", withoutEnlargement: true })
    .toBuffer();
  const itemMeta = await sharp(itemBuffer).metadata();

  const itemLeft = Math.round((canvasW - itemMeta.width) / 2);
  const itemTop = Math.round(canvasH * COMPOSITION_DEFAULTS.itemVerticalBias - itemMeta.height / 2);

  const layers = [];

  try {
    const ambient = await createAmbientShadow(itemBuffer, itemMeta.width, itemMeta.height);
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
    const contact = await createContactShadow(itemMeta.width, canvasW, canvasH);
    const contactLeft = Math.round((canvasW - contact.width) / 2);
    const contactTop = itemTop + itemMeta.height - Math.round(contact.height * 0.3);
    layers.push({
      input: contact.buffer,
      left: Math.max(0, contactLeft),
      top: Math.min(canvasH - contact.height, Math.max(0, contactTop)),
    });
  } catch {
    logger.warn("Contact shadow failed, skipping");
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

export async function overlayLogo({ scenePath, logoPath, logoPosition = DEFAULT_LOGO_POSITION }) {
  const sceneMeta = await sharp(scenePath).metadata();
  const logo = await prepareLogo(logoPath, sceneMeta.width);
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

export async function composePreview({ backgroundPath, transparentItemPath }) {
  const bgMeta = await sharp(backgroundPath).metadata();
  const canvasW = bgMeta.width;
  const canvasH = bgMeta.height;

  const maxItemW = Math.round(canvasW * COMPOSITION_DEFAULTS.itemScale);
  const maxItemH = Math.round(canvasH * COMPOSITION_DEFAULTS.itemScale);
  const itemBuffer = await sharp(transparentItemPath)
    .resize({ width: maxItemW, height: maxItemH, fit: "inside", withoutEnlargement: true })
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
