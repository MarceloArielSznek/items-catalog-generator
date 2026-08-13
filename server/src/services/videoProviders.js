/**
 * Video generation providers.
 * Each generator returns { buffer, contentType, meta } for an MP4 clip.
 *
 * Providers:
 *   openai — Sora 2 / Sora 2 Pro   (POST /v1/videos → poll → download)
 *   gemini — Veo 3 / Veo 3 Fast    (predictLongRunning → poll operation → download)
 *
 * Both APIs are long-running: you submit a job, poll until it finishes, then
 * download the bytes. This mirrors the submit→poll→download pattern already used
 * for Black Forest Labs images in imageProviders.js. An optional `onProgress`
 * callback receives { status, progress, elapsedMs } so callers can stream ticks.
 */

import env from '../config/env.js';
import logger from '../utils/logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Model catalogs (surfaced to the UI) ───────────────────────────────────────

export const SORA_MODELS = [
  { id: 'sora-2',     label: 'Sora 2',     note: 'Faster, lower cost' },
  { id: 'sora-2-pro', label: 'Sora 2 Pro', note: 'Higher fidelity, pricier' },
];

export const VEO_MODELS = [
  { id: 'veo-3.1-generate-preview',      label: 'Veo 3.1',      note: 'Highest fidelity' },
  { id: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast', note: 'Quicker, lower cost' },
  { id: 'veo-3.1-lite-generate-preview', label: 'Veo 3.1 Lite', note: 'Cheapest' },
];

// Valid Sora sizes keyed by orientation.
export const SORA_SIZES = {
  landscape: '1280x720',
  portrait: '720x1280',
};

// ── OpenAI Sora ───────────────────────────────────────────────────────────────

export async function generateWithSora(prompt, {
  model = 'sora-2',
  seconds = '8',
  size = '1280x720',
  onProgress = () => {},
} = {}) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

  const authHeader = { Authorization: `Bearer ${env.OPENAI_API_KEY}` };
  const startedAt = Date.now();

  // 1. Submit the job
  logger.info(`[Sora] Submitting ${model} (${seconds}s, ${size})`);
  const submitRes = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, seconds: String(seconds), size }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.json().catch(() => ({}));
    throw new Error(`Sora submit failed ${submitRes.status}: ${body.error?.message || submitRes.statusText}`);
  }
  const job = await submitRes.json();
  const jobId = job.id;
  if (!jobId) throw new Error('Sora did not return a job id');
  logger.info(`[Sora] Job ${jobId} submitted, polling…`);
  onProgress({ status: 'queued', progress: Number(job.progress) || 0, elapsedMs: Date.now() - startedAt });

  // 2. Poll until completed (max ~15 minutes)
  for (let attempt = 0; attempt < 180; attempt++) {
    await sleep(5000);
    const pollRes = await fetch(`https://api.openai.com/v1/videos/${jobId}`, { headers: authHeader });
    if (!pollRes.ok) continue;
    const status = await pollRes.json();
    const progress = Number(status.progress) || 0;
    onProgress({ status: status.status, progress, elapsedMs: Date.now() - startedAt });

    if (status.status === 'completed') {
      logger.info(`[Sora] Job ${jobId} completed, downloading…`);
      const dl = await fetch(`https://api.openai.com/v1/videos/${jobId}/content`, { headers: authHeader });
      if (!dl.ok) throw new Error(`Sora content download failed (${dl.status})`);
      const buffer = Buffer.from(await dl.arrayBuffer());
      return { buffer, contentType: 'video/mp4', meta: { provider: 'openai', model, seconds, size } };
    }
    if (status.status === 'failed') {
      throw new Error(`Sora job failed: ${status.error?.message || 'unknown error'}`);
    }
    logger.info(`[Sora] Job ${jobId} ${status.status} ${progress}% (attempt ${attempt + 1})`);
  }
  throw new Error('Sora job timed out after ~15 minutes');
}

// ── Google Veo ────────────────────────────────────────────────────────────────

// Dig a downloadable video reference out of a Veo operation response — the field
// path has shifted across API versions, so probe the known shapes defensively.
function extractVeoVideo(response) {
  const candidates = [
    response?.generateVideoResponse?.generatedSamples,
    response?.generateVideoResponse?.generatedVideos,
    response?.generatedVideos,
    response?.generatedSamples,
  ].find(Array.isArray);
  const sample = candidates?.[0];
  const video = sample?.video || sample;
  return {
    uri: video?.uri || video?.videoUri || null,
    base64: video?.bytesBase64Encoded || video?.videoBytes || null,
  };
}

export async function generateWithVeo(prompt, {
  model = 'veo-3.1-generate-preview',
  aspectRatio = '16:9',
  onProgress = () => {},
} = {}) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured — get yours at aistudio.google.com');

  const keyHeader = { 'x-goog-api-key': env.GEMINI_API_KEY };
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  const startedAt = Date.now();

  // 1. Start the long-running operation. We don't set `generateAudio` (some Veo
  //    tiers reject it); silent landing clips get their audio stripped later.
  logger.info(`[Veo] Submitting ${model} (${aspectRatio})`);
  const submitRes = await fetch(`${base}/models/${model}:predictLongRunning`, {
    method: 'POST',
    headers: { ...keyHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio } }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.json().catch(() => ({}));
    throw new Error(`Veo submit failed ${submitRes.status}: ${body.error?.message || submitRes.statusText}`);
  }
  const op = await submitRes.json();
  const opName = op.name;
  if (!opName) throw new Error('Veo did not return an operation name');
  logger.info(`[Veo] Operation ${opName} started, polling…`);
  onProgress({ status: 'queued', progress: 0, elapsedMs: Date.now() - startedAt });

  // 2. Poll the operation until done (max ~15 minutes)
  for (let attempt = 0; attempt < 180; attempt++) {
    await sleep(5000);
    const pollRes = await fetch(`${base}/${opName}`, { headers: keyHeader });
    if (!pollRes.ok) continue;
    const status = await pollRes.json();
    onProgress({ status: status.done ? 'completed' : 'processing', progress: status.done ? 100 : 0, elapsedMs: Date.now() - startedAt });

    if (status.error) throw new Error(`Veo job failed: ${status.error.message || 'unknown error'}`);
    if (!status.done) {
      logger.info(`[Veo] Operation still running (attempt ${attempt + 1})`);
      continue;
    }

    // 3. Done — pull the video bytes
    const { uri, base64 } = extractVeoVideo(status.response);
    if (base64) {
      logger.info('[Veo] Operation done, decoding inline bytes');
      return { buffer: Buffer.from(base64, 'base64'), contentType: 'video/mp4', meta: { provider: 'gemini', model, aspectRatio } };
    }
    if (uri) {
      logger.info(`[Veo] Operation done, downloading ${uri}`);
      const dl = await fetch(uri, { headers: keyHeader });
      if (!dl.ok) throw new Error(`Veo content download failed (${dl.status})`);
      return { buffer: Buffer.from(await dl.arrayBuffer()), contentType: 'video/mp4', meta: { provider: 'gemini', model, aspectRatio } };
    }
    throw new Error('Veo finished but returned no video data');
  }
  throw new Error('Veo job timed out after ~15 minutes');
}

// ── Router ────────────────────────────────────────────────────────────────────

/**
 * Generate a video with the chosen provider.
 * @param {string} prompt
 * @param {object} opts
 * @param {'openai'|'gemini'} opts.provider
 * @param {string} opts.model         Provider-specific model id
 * @param {string} opts.orientation   'landscape' | 'portrait'
 * @param {string} opts.seconds       Sora clip length ('4' | '8' | '12')
 * @param {function} opts.onProgress
 * @returns {Promise<{buffer: Buffer, contentType: string, meta: object}>}
 */
export async function generateVideo(prompt, { provider = 'openai', model, orientation = 'landscape', seconds = '8', silent = true, onProgress } = {}) {
  logger.info(`[VideoProvider] provider=${provider} model=${model || 'default'} orientation=${orientation}`);

  switch (provider) {
    case 'gemini':
      return generateWithVeo(prompt, {
        model,
        aspectRatio: orientation === 'portrait' ? '9:16' : '16:9',
        onProgress,
      });

    case 'openai':
    default:
      return generateWithSora(prompt, {
        model,
        seconds,
        size: orientation === 'portrait' ? SORA_SIZES.portrait : SORA_SIZES.landscape,
        onProgress,
      });
  }
}

/**
 * Which video providers are configured (have API keys), plus their model lists.
 */
export function getAvailableVideoProviders() {
  return {
    openai: { available: !!env.OPENAI_API_KEY, models: SORA_MODELS },
    gemini: { available: !!env.GEMINI_API_KEY, models: VEO_MODELS },
  };
}
