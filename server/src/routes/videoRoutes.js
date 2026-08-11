/**
 * Org preview-video routes.
 * Generates short promo/preview clips that present the company or its industry,
 * using the same org context that drives item images. Videos live on disk under
 * generated-orgs/videos/<slug>/ with a sidecar index.json manifest — kept out of
 * the org JSON so nothing here leaks into the Menaia deploy payload.
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import { getOrg } from '../services/orgStorageService.js';
import { generateVideo, getAvailableVideoProviders } from '../services/videoProviders.js';
import { concatVideos, stripAudio, boomerang } from '../services/videoPostProcess.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIDEOS_ROOT = path.resolve(__dirname, '../generated-orgs/videos');

// ── Storage helpers ───────────────────────────────────────────────────────────

function videoDir(slug) {
  return path.join(VIDEOS_ROOT, slug);
}
function videoFilePath(slug, id) {
  return path.join(videoDir(slug), `${id}.mp4`);
}
function manifestPath(slug) {
  return path.join(videoDir(slug), 'index.json');
}
function videoApiUrl(slug, id) {
  return `/api/orgs/${slug}/video-file/${id}.mp4`;
}
function readManifest(slug) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(slug), 'utf8'));
  } catch {
    return [];
  }
}
function writeManifest(slug, entries) {
  fs.mkdirSync(videoDir(slug), { recursive: true });
  fs.writeFileSync(manifestPath(slug), JSON.stringify(entries, null, 2));
}
// Non-random, collision-safe id (Math.random is unavailable in some sandboxes).
function makeVideoId() {
  return `vid-${Date.now().toString(36)}`;
}

// ── Prompt builder — cinematic preview from org context ───────────────────────

const KIND_GUIDE = {
  company:
    'Present THIS specific company: a short, upbeat brand preview that showcases their team, work, and the results they deliver for customers.',
  industry:
    'Present the TRADE/INDUSTRY in general (not one company): an aspirational look at the craft, the work environment, and the value it brings to homeowners.',
};

// Landing-page rules shared by every video prompt: silent, no on-screen text,
// no logos/branding, no visible company name. Kept as instructions to the
// prompt-writing model (gpt-4o), not to the video model.
const LANDING_RULES = `These clips play muted on a landing page, so:
- Never put any on-screen text, captions, numbers, signage, logos, watermarks, or brand names into the scene. Vehicles and uniforms are plain and unbranded — describe a "plain clean work van" and "solid-color uniforms", never a "branded" one.
- Never describe spoken words, voiceover, dialogue, or narration.
- Do not name the company anywhere in the visible scene.
Video models are negation-blind: never write "no X" or "without X" — describe the positive scene you want instead.`;

// Shot direction for company/industry previews: always workers-in-action, never
// clients or empty spaces, and a drone establishing shot to open.
const SHOT_DISCIPLINE = `Shot discipline — follow strictly:
- The video opens with an aerial drone shot gliding down toward and framing the house, then descends into the crew at work.
- EVERY scene must have at least one technician or crew member actively performing hands-on work — installing, spraying, carrying materials, measuring, operating equipment. Something is always in motion; there are never empty or static spaces.
- The only people on screen are workers. Homeowners, clients, customers, and residents never appear.
- Pack in as many of the company's own elements as possible: the crew, their tools and equipment, work vehicles, ladders, hoses, and the actual job in progress.
- Every interior and exterior shown is an active worksite with someone working in it.`;

async function buildSmartVideoPrompt(openai, org, { kind = 'company', extra = '', count = 1 } = {}) {
  const services = (org.resources?.categories || []).slice(0, 6).map((c) => c.name).filter(Boolean);
  const { home, technician, styleNotes } = org.imageStyle || {};
  const notes = (extra || '').replace(/\n+/g, ' ').trim().slice(0, 400);
  const multi = count > 1;

  const systemPrompt = `You write prompts for AI video models (OpenAI Sora and Google Veo) that produce short, professional ~8-second promotional preview clips for home-services contractors.
Describe cinematic, photoreal, documentary-commercial scenes: camera movement, subjects, action, setting, lighting, and mood.
${LANDING_RULES}
${SHOT_DISCIPLINE}
${multi
  ? `Output a JSON object {"shots": ["...", "..."]} with exactly ${count} prompts forming ONE continuous piece: shot 1 is the aerial drone approach to the house descending onto the crew; the remaining shots move through the crew performing different hands-on tasks, each a self-contained ~8-second scene with workers active in every frame. Keep the property, crew, wardrobe, and lighting IDENTICAL across shots for visual continuity. Output ONLY the JSON.`
  : `Output ONLY the prompt — one vivid ~8-second scene that opens on the drone approach and lands on a technician actively at work. No preamble, no quotes.`}`;

  const userMessage = [
    KIND_GUIDE[kind] || KIND_GUIDE.company,
    '',
    `Industry / trade: ${org.industry || 'home services'}`,
    org.region ? `Region: ${org.region}` : '',
    services.length ? `Representative services: ${services.join(', ')}` : '',
    '',
    'Visual style to echo (keep it consistent):',
    home ? `Property: ${home}` : 'Property: typical residential home.',
    technician ? `Technician: ${technician}` : '',
    styleNotes ? `Style: ${styleNotes}` : '',
    '',
    notes ? `Extra direction from the user (honor this): ${notes}` : '',
    '',
    multi ? `Write the ${count}-shot JSON now.` : 'Write one vivid ~8-second video prompt.',
  ].filter(Boolean).join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: multi ? 500 : 300,
    temperature: 0.7,
    ...(multi ? { response_format: { type: 'json_object' } } : {}),
  });

  const content = response.choices[0].message.content.trim();
  if (!multi) return [content];

  try {
    const parsed = JSON.parse(content);
    const shots = Array.isArray(parsed.shots) ? parsed.shots.filter(Boolean) : [];
    if (shots.length) return shots.slice(0, count);
  } catch { /* fall through */ }
  return [content]; // fallback: single prompt if JSON parsing fails
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/orgs/video-providers — which video providers are configured + models
router.get('/video-providers', (_req, res) => {
  res.json({ success: true, data: getAvailableVideoProviders() });
});

// GET /api/orgs/:slug/videos — list generated preview videos (manifest)
router.get('/:slug/videos', (req, res) => {
  const org = getOrg(req.params.slug);
  if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
  res.json({ success: true, data: readManifest(req.params.slug) });
});

// GET /api/orgs/:slug/video-file/:filename — stream an MP4 (with range support)
router.get('/:slug/video-file/:filename', (req, res) => {
  const id = req.params.filename.replace(/\.mp4$/i, '');
  const p = videoFilePath(req.params.slug, id);
  if (!fs.existsSync(p)) return res.status(404).send('Not found');

  const { size } = fs.statSync(p);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-store');

  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match && match[1] ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : size - 1;
    if (start >= size || end >= size) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    return fs.createReadStream(p, { start, end }).pipe(res);
  }

  res.setHeader('Content-Length', size);
  fs.createReadStream(p).pipe(res);
});

// DELETE /api/orgs/:slug/video/:id — remove one preview video
router.delete('/:slug/video/:id', (req, res) => {
  const org = getOrg(req.params.slug);
  if (!org) return res.status(404).json({ success: false, error: 'Org not found' });
  const { id } = req.params;
  try { fs.unlinkSync(videoFilePath(req.params.slug, id)); } catch { /* already gone */ }
  const next = readManifest(req.params.slug).filter((v) => v.id !== id);
  writeManifest(req.params.slug, next);
  res.json({ success: true, data: next });
});

// POST /api/orgs/:slug/video/generate — SSE stream: build prompt → generate → save.
// Body: { provider, model, kind, orientation, seconds, extra, prompt? }
router.post('/:slug/video/generate', async (req, res) => {
  const org = getOrg(req.params.slug);
  if (!org) return res.status(404).json({ success: false, error: 'Org not found' });

  const {
    provider = 'openai',
    model,
    kind = 'company',
    orientation = 'landscape',
    seconds = '8',
    extra = '',
    prompt: promptOverride = '',
    silent = true,
    segments = 1,
    loop = 'none',
    dryRun = false,
  } = req.body || {};
  const segCount = Math.max(1, Math.min(3, Number(segments) || 1));
  const pingPong = loop === 'boomerang';

  const providers = getAvailableVideoProviders();
  if (!providers[provider]?.available) {
    return res.status(400).json({ success: false, error: `Provider "${provider}" is not configured (missing API key)` });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  // Heartbeat comments keep proxies from closing the long-lived stream.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);

  const providerLabel = provider === 'gemini' ? 'Veo' : 'Sora';

  try {
    // 1. Build the shot prompt(s). One per segment; a manual override always maps
    //    to a single clip.
    let prompts;
    const override = (promptOverride || '').trim();
    if (override) {
      prompts = [override];
    } else {
      send({ type: 'status', phase: 'prompting', message: 'Writing the video prompt from org context…' });
      const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;
      if (!openai) throw new Error('OPENAI_API_KEY is required to build the prompt');
      prompts = await buildSmartVideoPrompt(openai, org, { kind, extra, count: segCount });
    }
    send({ type: 'prompt', prompt: prompts.join('\n\n— — —\n\n') });

    // Dry run: return the prompt(s) only, no (paid) generation.
    if (dryRun) {
      send({ type: 'done', dryRun: true, prompts });
      return;
    }

    // 2. Generate each segment, streaming provider progress (labelled by segment).
    const buffers = [];
    let lastMeta = { model };
    for (let s = 0; s < prompts.length; s++) {
      const label = prompts.length > 1 ? ` (clip ${s + 1}/${prompts.length})` : '';
      send({ type: 'status', phase: 'generating', message: `Generating with ${providerLabel}${label}… this can take a few minutes.` });
      const { buffer, meta } = await generateVideo(prompts[s], {
        provider,
        model,
        orientation,
        seconds,
        silent,
        onProgress: (p) => send({ type: 'progress', ...p, segment: s + 1, segments: prompts.length }),
      });
      buffers.push(buffer);
      lastMeta = meta;
    }

    // 3. Post-process: concat multiple clips (always silent), or strip audio from
    //    a single clip when a silent landing video was requested.
    let finalBuffer;
    if (buffers.length > 1) {
      send({ type: 'status', phase: 'stitching', message: `Stitching ${buffers.length} clips into one video…` });
      finalBuffer = await concatVideos(buffers);
    } else if (silent) {
      send({ type: 'status', phase: 'stitching', message: 'Removing the audio track…' });
      finalBuffer = await stripAudio(buffers[0]);
    } else {
      finalBuffer = buffers[0];
    }

    // Optional seamless ping-pong loop (forward + reversed). Doubles the runtime.
    if (pingPong) {
      send({ type: 'status', phase: 'stitching', message: 'Building a seamless ping-pong loop…' });
      finalBuffer = await boomerang(finalBuffer);
    }

    // 4. Persist the MP4 + manifest entry.
    const id = makeVideoId();
    fs.mkdirSync(videoDir(req.params.slug), { recursive: true });
    fs.writeFileSync(videoFilePath(req.params.slug, id), finalBuffer);
    const entry = {
      id,
      url: videoApiUrl(req.params.slug, id),
      title: kind === 'industry' ? `${org.industry || 'Industry'} preview` : `${org.name} preview`,
      provider,
      model: lastMeta.model,
      kind,
      orientation,
      segments: prompts.length,
      loop: pingPong ? 'boomerang' : 'none',
      // Sora honors the requested length; Veo clips are ~8s each. Ping-pong doubles it.
      durationSec: (provider === 'openai' ? Number(seconds) * prompts.length : prompts.length * 8) * (pingPong ? 2 : 1),
      silent: silent || prompts.length > 1 || pingPong,
      prompt: prompts.join('\n\n— — —\n\n'),
      bytes: finalBuffer.length,
      createdAt: new Date().toISOString(),
    };
    const manifest = [entry, ...readManifest(req.params.slug)];
    writeManifest(req.params.slug, manifest);

    logger.info(`[video] Saved ${id} for ${req.params.slug} (${provider}/${lastMeta.model}, ${prompts.length} seg, ${finalBuffer.length} bytes)`);
    send({ type: 'done', video: entry });
  } catch (err) {
    logger.error(`[video generate] ${err.message}`);
    send({ type: 'error', error: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

export default router;
