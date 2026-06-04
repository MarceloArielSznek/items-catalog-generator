/**
 * Image generation providers.
 * Each function returns a Buffer (JPEG/PNG) ready to be processed by sharp.
 *
 * Providers:
 *   openai    — gpt-image-1 (Draft / Good / Best)
 *   replicate — Flux 1.1 Pro via Replicate API
 *   gemini    — Nano Banana 2 (gemini-3.1-flash-image-preview)
 */

import OpenAI from 'openai';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import env from '../config/env.js';
import logger from '../utils/logger.js';

// ── OpenAI (gpt-image-1) ──────────────────────────────────────────────────────

export async function generateWithOpenAI(prompt, { model = 'gpt-image-1', quality = 'low' } = {}) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const response = await openai.images.generate({
    model,
    prompt,
    n: 1,
    size: '1536x1024',
    quality,
  });

  const image = response.data?.[0];
  if (image?.b64_json) return Buffer.from(image.b64_json, 'base64');

  if (image?.url) {
    const res = await fetch(image.url);
    if (!res.ok) throw new Error(`Could not download OpenAI image (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  throw new Error('OpenAI returned no image data');
}

// ── Black Forest Labs direct API ──────────────────────────────────────────────
// Used when REPLICATE_API_KEY starts with 'bfl_' (BFL API key, not Replicate)

// Map frontend model IDs to BFL API endpoints
const BFL_ENDPOINTS = {
  'black-forest-labs/flux-1.1-pro':       'https://api.bfl.ml/v1/flux-pro-1.1',
  'black-forest-labs/flux-1.1-pro-ultra': 'https://api.bfl.ml/v1/flux-pro-1.1-ultra',
};

async function generateWithBFL(prompt, { model = 'black-forest-labs/flux-1.1-pro' } = {}) {
  const endpoint = BFL_ENDPOINTS[model] || BFL_ENDPOINTS['black-forest-labs/flux-1.1-pro'];
  const headers = { 'X-Key': env.REPLICATE_API_KEY, 'Content-Type': 'application/json' };

  logger.info(`[BFL] Submitting to ${endpoint}`);

  // 1. Submit job
  const submitRes = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, width: 1536, height: 1024, output_format: 'jpeg' }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.json().catch(() => ({}));
    throw new Error(`BFL submit failed ${submitRes.status}: ${body.detail || submitRes.statusText}`);
  }
  const { id } = await submitRes.json();
  if (!id) throw new Error('BFL did not return a job ID');
  logger.info(`[BFL] Job ${id} submitted, polling…`);

  // 2. Poll until ready (max 120 seconds)
  const pollUrl = `https://api.bfl.ml/v1/get_result?id=${id}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(pollUrl, { headers: { 'X-Key': env.REPLICATE_API_KEY } });
    if (!pollRes.ok) continue;
    const result = await pollRes.json();
    if (result.status === 'Ready' && result.result?.sample) {
      logger.info(`[BFL] Job ${id} ready: ${result.result.sample}`);
      const imgRes = await fetch(result.result.sample);
      if (!imgRes.ok) throw new Error(`BFL image download failed (${imgRes.status})`);
      return Buffer.from(await imgRes.arrayBuffer());
    }
    if (result.status === 'Error') throw new Error(`BFL job failed: ${result.result || 'unknown error'}`);
    logger.info(`[BFL] Job ${id} status: ${result.status} (attempt ${attempt + 1})`);
  }
  throw new Error('BFL job timed out after 120 seconds');
}

// ── Replicate — Flux 1.1 Pro ──────────────────────────────────────────────────

export async function generateWithReplicate(prompt, { model = 'black-forest-labs/flux-1.1-pro' } = {}) {
  if (!env.REPLICATE_API_KEY) throw new Error('REPLICATE_API_KEY is not configured — get yours at replicate.com or api.bfl.ml');

  // Auto-detect BFL key (starts with 'bfl_') vs Replicate key (starts with 'r8_')
  if (env.REPLICATE_API_KEY.startsWith('bfl_')) {
    return generateWithBFL(prompt, { model });
  }

  const replicate = new Replicate({ auth: env.REPLICATE_API_KEY });

  logger.info(`[Replicate] Running ${model}`);
  const output = await replicate.run(model, {
    input: {
      prompt,
      width: 1536,
      height: 1024,
      output_format: 'jpg',
      output_quality: 90,
      num_inference_steps: 28,
    },
  });

  const url = Array.isArray(output) ? output[0] : output;
  if (!url) throw new Error('Replicate returned no output URL');

  logger.info(`[Replicate] Image ready: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download Replicate image (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Google Gemini — Nano Banana 2 ─────────────────────────────────────────────

// Resolution map: quality label → actual pixel target for Gemini
const GEMINI_IMAGE_SIZE = {
  '1k': 1024,
  '4k': 2048,
  default: 1024,
};

export async function generateWithGemini(prompt, { model = 'gemini-3.1-flash-image-preview', quality = '1k' } = {}) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured — get yours at aistudio.google.com');

  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const genModel = genAI.getGenerativeModel({ model });

  logger.info(`[Gemini] Generating with ${model} (${quality})`);

  const result = await genModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['image'],
    },
  });

  const parts = result.response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart?.inlineData?.data) {
    throw new Error('Gemini returned no image data');
  }

  logger.info(`[Gemini] Image received (${imagePart.inlineData.mimeType})`);
  return Buffer.from(imagePart.inlineData.data, 'base64');
}

// ── Router — pick provider based on request params ────────────────────────────

/**
 * Generate an image using the specified provider.
 * @param {string} prompt - The image generation prompt
 * @param {object} opts
 * @param {string} opts.provider - 'openai' | 'replicate' | 'gemini'
 * @param {string} opts.model   - Provider-specific model ID
 * @param {string} opts.quality - Quality level (provider-specific meaning)
 * @returns {Promise<Buffer>} Raw image buffer
 */
export async function generateImage(prompt, { provider = 'openai', model, quality } = {}) {
  logger.info(`[ImageProvider] provider=${provider} model=${model || 'default'} quality=${quality || 'default'}`);

  switch (provider) {
    case 'replicate':
      return generateWithReplicate(prompt, { model });

    case 'gemini':
      return generateWithGemini(prompt, { model, quality });

    case 'openai':
    default:
      return generateWithOpenAI(prompt, { model, quality });
  }
}

/**
 * Check which providers are configured (have API keys).
 */
export function getAvailableProviders() {
  return {
    openai:    !!env.OPENAI_API_KEY,
    replicate: !!env.REPLICATE_API_KEY,
    gemini:    !!env.GEMINI_API_KEY,
  };
}
