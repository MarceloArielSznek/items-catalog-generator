import logger from "../utils/logger.js";
import { getUploadedFilePath, buildPublicUrl, cleanupFiles } from "../services/storageService.js";
import { removeItemBackground } from "../services/backgroundRemovalService.js";
import { composeFullImage, overlayLogo, composePreview, resizeToFormat } from "../services/compositionService.js";
import { generateSceneImage, refineComposedImage } from "../services/openaiImageService.js";
import { getScene } from "../services/sceneService.js";
import {
  DEFAULT_LOGO_POSITION,
  LOGO_POSITIONS,
  GENERATION_MODES,
  DEFAULT_MODE,
  OUTPUT_FORMATS,
  DEFAULT_FORMAT,
  COMPOSITION_DEFAULTS,
} from "../../../shared/constants/imageRules.js";

async function runQuickPipeline({ backgroundPath, itemPath, itemScale, shadowIntensity }) {
  const { outputPath: transparentPath } = await removeItemBackground(itemPath);
  const result = await composeFullImage({ backgroundPath, transparentItemPath: transparentPath, itemScale, shadowIntensity });
  return { ...result, tempFiles: [transparentPath], usage: null, prompt: null, stub: false };
}

async function runStandardPipeline({ backgroundPath, itemPath, itemName, instruction, itemScale }) {
  const { outputPath: transparentPath } = await removeItemBackground(itemPath);
  const { outputPath: precompPath } = await composePreview({ backgroundPath, transparentItemPath: transparentPath, itemScale });
  const refined = await refineComposedImage({ composedImagePath: precompPath, itemName, instruction });

  return {
    outputFilename: refined.sceneFilename,
    outputPath: refined.scenePath,
    tempFiles: [transparentPath, precompPath],
    usage: refined.usage,
    prompt: refined.prompt,
    stub: refined.stub,
  };
}

async function runPremiumPipeline({ backgroundPath, itemPath, itemName, instruction }) {
  const aiResult = await generateSceneImage({
    backgroundPath,
    itemPath,
    itemName,
    instruction,
    model: "gpt-image-1",
  });

  if (aiResult.stub) {
    return { outputFilename: null, outputPath: null, tempFiles: [], usage: null, prompt: aiResult.prompt, stub: true };
  }

  return {
    outputFilename: aiResult.sceneFilename,
    outputPath: aiResult.scenePath,
    tempFiles: [],
    usage: aiResult.usage,
    prompt: aiResult.prompt,
    stub: false,
  };
}

const PIPELINES = {
  [GENERATION_MODES.QUICK]:    runQuickPipeline,
  [GENERATION_MODES.STANDARD]: runStandardPipeline,
  [GENERATION_MODES.PREMIUM]:  runPremiumPipeline,
};

function parseOptions(body) {
  let logoPosition = body.logoPosition || DEFAULT_LOGO_POSITION;
  if (!LOGO_POSITIONS.includes(logoPosition)) logoPosition = DEFAULT_LOGO_POSITION;

  let mode = body.mode || DEFAULT_MODE;
  if (!Object.values(GENERATION_MODES).includes(mode)) mode = DEFAULT_MODE;

  let format = body.format || DEFAULT_FORMAT;
  if (!OUTPUT_FORMATS[format]) format = DEFAULT_FORMAT;

  let itemScale = parseFloat(body.itemScale);
  if (isNaN(itemScale) || itemScale < 0.05 || itemScale > 0.9) {
    itemScale = COMPOSITION_DEFAULTS.itemScale;
  }

  let shadowIntensity = parseFloat(body.shadowIntensity);
  if (isNaN(shadowIntensity) || shadowIntensity < 0 || shadowIntensity > 1) {
    shadowIntensity = 1;
  }

  return { logoPosition, mode, format, itemName: body.itemName, instruction: body.instruction, itemScale, shadowIntensity };
}

async function runGeneration({ backgroundPath, itemPath, logoPath, logoPosition, mode, format, itemName, instruction, itemScale, shadowIntensity }) {
  const start = Date.now();

  const pipeline = PIPELINES[mode];
  const result = await pipeline({ backgroundPath, itemPath, itemName, instruction, itemScale, shadowIntensity });
  const tempFiles = result.tempFiles || [];

  if (result.stub || !result.outputPath) {
    const elapsed = Date.now() - start;
    return {
      data: { imageUrl: null, filename: null, prompt: result.prompt, stub: true, usage: null, mode, format, elapsed_ms: elapsed },
      tempFiles,
    };
  }

  const composedPath = result.outputPath;
  const resized = await resizeToFormat(composedPath, format);
  if (resized.outputPath !== composedPath) tempFiles.push(composedPath);

  const final = await overlayLogo({ scenePath: resized.outputPath, logoPath, logoPosition });
  if (final.outputPath !== resized.outputPath) tempFiles.push(resized.outputPath);

  const elapsed = Date.now() - start;
  const imageUrl = buildPublicUrl(final.outputFilename);
  const spec = OUTPUT_FORMATS[format];

  logger.info("Generation complete", { mode, format, size: `${spec.width}x${spec.height}`, filename: final.outputFilename, elapsed_ms: elapsed });

  return {
    data: {
      imageUrl,
      filename: final.outputFilename,
      prompt: result.prompt,
      stub: false,
      usage: result.usage || null,
      mode,
      format,
      elapsed_ms: elapsed,
    },
    tempFiles,
  };
}

export async function handleGenerateCatalogImage(req, res, next) {
  const uploadedPaths = [];
  let tempFiles = [];

  try {
    const backgroundFile = req.files.background[0];
    const itemFile = req.files.item[0];
    const logoFile = req.files.logo[0];

    const backgroundPath = getUploadedFilePath(backgroundFile);
    const itemPath = getUploadedFilePath(itemFile);
    const logoPath = getUploadedFilePath(logoFile);
    uploadedPaths.push(backgroundPath, itemPath, logoPath);

    const { logoPosition, mode, format, itemName, instruction, itemScale, shadowIntensity } = parseOptions(req.body);

    logger.info("Generate catalog image request", {
      mode, format, logoPosition, itemScale, shadowIntensity,
      background: backgroundFile.originalname,
      item: itemFile.originalname,
      logo: logoFile.originalname,
      itemName: itemName || "(none)",
    });

    const result = await runGeneration({ backgroundPath, itemPath, logoPath, logoPosition, mode, format, itemName, instruction, itemScale, shadowIntensity });
    tempFiles = result.tempFiles;

    res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    next(err);
  } finally {
    cleanupFiles([...uploadedPaths, ...tempFiles]);
  }
}

export async function handleRemoveBackground(req, res, next) {
  const uploadedPaths = [];
  try {
    const itemFile = req.files?.item?.[0];
    if (!itemFile) {
      return res.status(400).json({ success: false, error: "Item file is required" });
    }

    const itemPath = getUploadedFilePath(itemFile);
    uploadedPaths.push(itemPath);

    const { outputPath, outputFilename } = await removeItemBackground(itemPath);
    const imageUrl = buildPublicUrl(outputFilename);

    logger.info("Background removal for preview", { outputFilename });
    res.status(200).json({ success: true, data: { imageUrl, filename: outputFilename } });
  } catch (err) {
    next(err);
  } finally {
    cleanupFiles(uploadedPaths);
  }
}

export async function handleGenerateWithScene(req, res, next) {
  const uploadedPaths = [];
  let tempFiles = [];

  try {
    const { sceneId } = req.params;
    const scene = await getScene(sceneId);
    if (!scene) {
      return res.status(404).json({ success: false, error: "Scene not found" });
    }

    const itemFile = req.files?.item?.[0];
    if (!itemFile) {
      return res.status(400).json({ success: false, error: "Item file is required" });
    }

    const itemPath = getUploadedFilePath(itemFile);
    uploadedPaths.push(itemPath);

    const { mode, format, itemName, instruction, itemScale, shadowIntensity } = parseOptions(req.body);
    const logoPosition = req.body.logoPosition && LOGO_POSITIONS.includes(req.body.logoPosition)
      ? req.body.logoPosition
      : scene.logoPosition;

    logger.info("Generate with scene", {
      sceneId, mode, format, logoPosition, itemScale, shadowIntensity,
      item: itemFile.originalname,
      itemName: itemName || "(none)",
    });

    const result = await runGeneration({
      backgroundPath: scene.backgroundPath,
      itemPath,
      logoPath: scene.logoPath,
      logoPosition,
      mode, format, itemName, instruction, itemScale, shadowIntensity,
    });
    tempFiles = result.tempFiles;

    res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    next(err);
  } finally {
    cleanupFiles([...uploadedPaths, ...tempFiles]);
  }
}
