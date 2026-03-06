import fsp from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import OpenAI, { toFile } from "openai";
import env from "../config/env.js";
import logger from "../utils/logger.js";
import { buildCompositionPrompt } from "../utils/promptBuilder.js";

const MIME_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const PRICING = {
  "gpt-image-1":      { textInput: 5.0, imageInput: 10.0, imageOutput: 40.0 },
  "gpt-image-1-mini": { textInput: 1.25, imageInput: 2.5, imageOutput: 10.0 },
};

let openaiClient = null;

function getClient() {
  if (!openaiClient) {
    if (!env.OPENAI_API_KEY || env.OPENAI_API_KEY === "sk-your-key-here") {
      return null;
    }
    openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function logUsage(usage, model) {
  if (!usage) return;

  const pricing = PRICING[model] || PRICING["gpt-image-1"];
  const inputDetails = usage.input_tokens_details || {};
  const textIn = inputDetails.text_tokens || 0;
  const imageIn = inputDetails.image_tokens || 0;
  const imageOut = usage.output_tokens || 0;

  const cost =
    (textIn / 1_000_000) * pricing.textInput +
    (imageIn / 1_000_000) * pricing.imageInput +
    (imageOut / 1_000_000) * pricing.imageOutput;

  logger.info(`OpenAI usage [${model}]`, {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    text_input_tokens: textIn,
    image_input_tokens: imageIn,
    estimated_cost_usd: `$${cost.toFixed(4)}`,
  });
}

async function prepareFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "image/png";
  const buffer = await fsp.readFile(filePath);
  return await toFile(buffer, path.basename(filePath), { type: mime });
}

export async function generateSceneImage({ backgroundPath, itemPath, itemName, instruction, model = "gpt-image-1" }) {
  const prompt = buildCompositionPrompt({ itemName, instruction });
  const client = getClient();

  if (!client) {
    logger.warn("OpenAI API key not configured — returning stub result");
    return {
      success: true,
      stub: true,
      message: "OpenAI API key not configured. Set OPENAI_API_KEY in .env.",
      scenePath: null,
      sceneFilename: null,
      prompt,
    };
  }

  logger.info(`Calling OpenAI images.edit [${model}]`, {
    backgroundPath,
    itemPath,
    promptLength: prompt.length,
  });

  const [bgFile, itemFile] = await Promise.all([
    prepareFile(backgroundPath),
    prepareFile(itemPath),
  ]);

  const quality = model === "gpt-image-1" ? "high" : "medium";

  const response = await client.images.edit({
    model,
    image: [bgFile, itemFile],
    prompt,
    size: "1024x1024",
    quality,
    input_fidelity: "high",
  });

  logUsage(response.usage, model);

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI returned no image data");
  }

  const outputFilename = `scene-${uuidv4()}.png`;
  const outputPath = path.resolve(env.GENERATED_DIR, outputFilename);

  await fsp.writeFile(outputPath, Buffer.from(b64, "base64"));

  logger.info("Scene image saved", { outputFilename, model });

  return {
    success: true,
    stub: false,
    sceneFilename: outputFilename,
    scenePath: outputPath,
    prompt,
    usage: response.usage || null,
  };
}

export async function refineComposedImage({ composedImagePath, itemName, instruction }) {
  const parts = [
    "Refine this catalog composition to look photorealistic.",
    "Blend the product naturally into the scene: match the lighting direction, color temperature, and ambient shadows of the background.",
    "Add a soft, realistic contact shadow directly beneath the product where it meets the surface.",
    "Keep the product appearance, shape, and labels exactly as shown — do not redesign or alter it.",
    "Do NOT add logos, watermarks, people, text, or any extra objects.",
    "The final result should look like a professional product photograph taken on location.",
  ];
  if (itemName) parts.push(`Product: ${itemName}.`);
  if (instruction) parts.push(instruction);
  const prompt = parts.join(" ");

  const client = getClient();
  if (!client) {
    logger.warn("OpenAI API key not configured — skipping refinement");
    return { scenePath: composedImagePath, sceneFilename: path.basename(composedImagePath), stub: true, prompt, usage: null };
  }

  logger.info("Calling OpenAI images.edit [gpt-image-1-mini] for refinement");

  const file = await prepareFile(composedImagePath);

  const response = await client.images.edit({
    model: "gpt-image-1-mini",
    image: file,
    prompt,
    size: "1024x1024",
    quality: "medium",
  });

  logUsage(response.usage, "gpt-image-1-mini");

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI returned no image data");
  }

  const outputFilename = `refined-${uuidv4()}.png`;
  const outputPath = path.resolve(env.GENERATED_DIR, outputFilename);
  await fsp.writeFile(outputPath, Buffer.from(b64, "base64"));

  logger.info("Refined image saved", { outputFilename });

  return {
    scenePath: outputPath,
    sceneFilename: outputFilename,
    stub: false,
    prompt,
    usage: response.usage || null,
  };
}
