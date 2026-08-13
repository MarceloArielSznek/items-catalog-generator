/**
 * Video post-processing via the system ffmpeg binary (no npm dependency).
 * Makes clips landing-page ready: strip audio (no voice/music), stitch multiple
 * short clips into one, optionally make a seamless ping-pong loop, and always
 * write a web-optimized MP4 (+faststart so it starts before fully downloading).
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import logger from '../utils/logger.js';

// H.264 / yuv420p / faststart = plays as a muted autoplay loop in every browser.
const WEB_OUTPUT = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 1024 * 1024 * 32 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(`ffmpeg failed: ${stderr?.slice(-400) || err.message}`));
      resolve();
    });
  });
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vid-'));
}

/**
 * Remove the audio track and web-optimize a single MP4.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
export async function stripAudio(buffer) {
  const dir = tmpDir();
  const inPath = path.join(dir, 'in.mp4');
  const outPath = path.join(dir, 'out.mp4');
  try {
    fs.writeFileSync(inPath, buffer);
    await run(['-y', '-i', inPath, '-an', ...WEB_OUTPUT, outPath]);
    logger.info('[ffmpeg] stripped audio + web-optimized');
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Concatenate several MP4 clips into one, dropping audio and web-optimizing.
 * @param {Buffer[]} buffers
 * @returns {Promise<Buffer>}
 */
export async function concatVideos(buffers) {
  if (buffers.length === 1) return stripAudio(buffers[0]);

  const dir = tmpDir();
  const outPath = path.join(dir, 'out.mp4');
  try {
    const inputs = [];
    buffers.forEach((buf, i) => {
      const p = path.join(dir, `seg${i}.mp4`);
      fs.writeFileSync(p, buf);
      inputs.push('-i', p);
    });
    const n = buffers.length;
    const streams = buffers.map((_, i) => `[${i}:v:0]`).join('');
    const filter = `${streams}concat=n=${n}:v=1:a=0[outv]`;
    await run(['-y', ...inputs, '-filter_complex', filter, '-map', '[outv]', ...WEB_OUTPUT, outPath]);
    logger.info(`[ffmpeg] concatenated ${n} clips`);
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Turn a clip into a seamless ping-pong loop: play forward, then reversed, so the
 * last frame equals the first — no visible jump when the landing loops it. Doubles
 * the clip's duration (no extra generation cost). Assumes audio already dropped.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
export async function boomerang(buffer) {
  const dir = tmpDir();
  const inPath = path.join(dir, 'in.mp4');
  const outPath = path.join(dir, 'out.mp4');
  try {
    fs.writeFileSync(inPath, buffer);
    const filter = '[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[outv]';
    await run(['-y', '-i', inPath, '-filter_complex', filter, '-map', '[outv]', ...WEB_OUTPUT, outPath]);
    logger.info('[ffmpeg] built ping-pong loop');
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
