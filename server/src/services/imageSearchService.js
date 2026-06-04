import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import env from "../config/env.js";
import logger from "../utils/logger.js";
import {
  buildLearnedRules,
  getLearnedDomainScore,
  getUrlKeywordScore,
  getTitleKeywordScore,
  loadRefinedModel,
} from "./learningEngine.js";
import { getAllFeedback } from "./feedbackService.js";

const BLACKLISTED_DOMAINS = [
  // Stock photo watermarks
  "gettyimages.com", "shutterstock.com", "dreamstime.com",
  "istockphoto.com", "alamy.com", "depositphotos.com",
  "123rf.com", "bigstockphoto.com", "stockfresh.com",
  // Retail/marketplace (product packaging shots)
  "amazon.com", "ebay.com", "walmart.com", "aliexpress.com",
  "alibaba.com", "etsy.com", "wayfair.com", "overstock.com",
  "target.com", "costco.com",
];

const PREFERRED_DOMAINS = [
  "homedepot.com", "lowes.com", "grainger.com",
  "familyhandyman.com", "thisoldhouse.com", "bobvila.com",
  "angieslist.com", "angi.com", "doityourself.com",
  "contractortalk.com", "probuilder.com", "constructiondive.com",
];

// ── Serper Image Search ───────────────────────────────────────────────────────

async function serperImageSearch(query, count = 10) {
  const apiKey = env.SERPER_API_KEY;
  if (!apiKey) throw new Error("Missing SERPER_API_KEY in env");

  const res = await fetch("https://google.serper.dev/images", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Negative terms aggressively filter out team/promo/portrait photos
      q: `${query} -watermark -amazon -ebay -packaging -"our team" -"meet the team" -"company" -portrait -"staff" -"crew photo" -headshot`,
      num: Math.min(count, 10),
      gl: "us",
      hl: "en",
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Serper API error ${res.status}: ${body?.message || res.statusText}`);
  }

  const data = await res.json();
  return (data.images || []).map((item) => ({
    url: item.imageUrl,
    thumbUrl: item.thumbnailUrl,
    width: item.imageWidth || 0,
    height: item.imageHeight || 0,
    domain: (() => { try { return new URL(item.imageUrl).hostname.replace("www.", ""); } catch { return ""; } })(),
    title: item.title || "",
    contextUrl: item.link || "",
  }));
}

// ── Programmatic scoring ──────────────────────────────────────────────────────

// Title/context keywords that strongly indicate team/promo photos — disqualify immediately
const TEAM_PHOTO_SIGNALS = [
  "our team", "meet the team", "staff", "crew photo", "headshot",
  "about us", "company photo", "employees", "technicians pose",
  "uniformed team", "group photo", "workers pose", "posing",
];

/**
 * Programmatic scoring — now includes learned rules from feedback history.
 * @param {object} img - image candidate
 * @param {string} categoryName - for category-specific domain preferences
 * @param {object|null} learnedRules - output of buildLearnedRules(), or null if no data
 */
function scoreImageProgrammatically(img, categoryName = "", learnedRules = null) {
  let score = 0;

  // Disqualify blacklisted domains
  if (BLACKLISTED_DOMAINS.some((d) => img.domain.includes(d))) return -1;

  // Disqualify team/promo photos based on title or context URL
  const titleLower = (img.title || "").toLowerCase();
  const contextLower = (img.contextUrl || "").toLowerCase();
  if (TEAM_PHOTO_SIGNALS.some((s) => titleLower.includes(s) || contextLower.includes(s))) {
    return -1;
  }

  // Resolution (max 40pts)
  const px = img.width * img.height;
  if (px >= 1000000) score += 40;       // ≥ 1MP
  else if (px >= 500000) score += 30;   // ≥ 500k
  else if (px >= 200000) score += 20;   // ≥ 200k
  else if (px >= 50000) score += 10;    // ≥ 50k
  else return -1;                        // too small

  // Aspect ratio (max 20pts) — prefer near-square or 4:3
  if (img.width > 0 && img.height > 0) {
    const ratio = img.width / img.height;
    if (ratio >= 0.8 && ratio <= 1.5) score += 20;
    else if (ratio >= 0.5 && ratio <= 2.0) score += 10;
  }

  // Preferred domain (max 20pts) — static known-good sources
  if (PREFERRED_DOMAINS.some((d) => img.domain.includes(d))) score += 20;

  // URL cleanliness — avoid URLs with "watermark", "sample", "preview"
  const urlLower = img.url.toLowerCase();
  if (urlLower.includes("watermark") || urlLower.includes("sample") || urlLower.includes("preview")) {
    return -1;
  }

  // ── Learned adjustments (from feedback history) ──────────────────────────────
  if (learnedRules) {
    // Domain learning: has user historically accepted/rejected images from this domain?
    const { adjustment: domainAdj, source } = getLearnedDomainScore(
      img.domain, categoryName, learnedRules
    );
    if (domainAdj !== 0) {
      score += domainAdj;
      logger.debug(`[Learned] ${img.domain} (${source}): ${domainAdj > 0 ? "+" : ""}${domainAdj}pts`);
    }

    // URL keyword learning: does the URL contain good/bad signals?
    score += getUrlKeywordScore(img.url);

    // Title keyword learning: does the title suggest team photo vs. service photo?
    score += getTitleKeywordScore(img.title);

    // Hard block from Opus 4.8 (-999 sentinel) or raw stats
    if (domainAdj <= -999) return -1;

    const globalStats = learnedRules.domainStats?.[img.domain];
    if (globalStats && globalStats.total >= 5 && globalStats.rate < 0.15) {
      logger.debug(`[Learned] ${img.domain} blocked (rate=${(globalStats.rate * 100).toFixed(0)}%, ${globalStats.total} samples)`);
      return -1;
    }
  }

  return score;
}

// ── Vision scoring via Claude Opus 4.8 with adaptive thinking + prompt caching ──

// Stable scoring instructions — cached across requests to save costs
const SCORING_SYSTEM_PROMPT = `You are an expert image selector for home services company SERVICE CATALOGS.
Your job: score images that will appear next to service descriptions.
The goal is to show WHAT THE SERVICE LOOKS LIKE — work being done or the finished result at a real home.

SCORING RULES (be strict):

SCORE 9-10 — Perfect:
✅ Technician actively performing the service at a residential property
✅ Finished result of the service (e.g. clean insulated attic, installed HVAC unit, sealed crawl space)
✅ Clear close-up of the work area showing what the service involves

SCORE 5-7 — Acceptable:
⚠️ Relevant job site or home environment, service not directly visible
⚠️ Equipment/materials in a real residential context (not isolated on white)

SCORE 1-3 — Reject immediately:
❌ Group photo, team photo, staff posing, "meet our team", company van photos — SCORE 1
❌ People in uniforms posing (not working) — SCORE 1
❌ Retail/Amazon product shot on white or studio background — SCORE 2
❌ Illustration, cartoon, clipart, 3D render, diagram — SCORE 2
❌ Watermarks, overlaid text, branded content — SCORE 2
❌ Unrelated content — SCORE 1

Always output ONLY a JSON array of integers, no explanation. Example: [8, 2, 9, 4, 7]`;

async function scoreWithVision(candidates, itemName, categoryName, industryContext = "", badExamples = []) {
  if (candidates.length === 0) return [];
  if (!env.OPENAI_API_KEY) {
    logger.warn("No OPENAI_API_KEY — using neutral scores");
    return candidates.map(() => 5);
  }
  return scoreWithOpenAI(candidates, itemName, categoryName, industryContext, badExamples);
}

// eslint-disable-next-line no-unused-vars -- kept for reference only, replaced by scoreWithOpenAI
async function scoreWithClaude_UNUSED(candidates, itemName, categoryName, industryContext = "", badExamples = []) {
  const anthropic = { messages: { create: () => { throw new Error("Anthropic not configured"); } } };

  const industryLine = industryContext ? `Industry context: ${industryContext}.` : "";

  // Build user content blocks — images first, then scoring instructions
  const content = [];

  // Candidate images
  for (let i = 0; i < candidates.length; i++) {
    content.push({ type: "text", text: `Image ${i + 1} (rate this):` });
    try {
      content.push({
        type: "image",
        source: { type: "url", url: candidates[i].thumbUrl },
      });
    } catch {
      // Skip unloadable images
    }
  }

  // Negative examples from user feedback (few-shot training)
  if (badExamples.length > 0) {
    content.push({
      type: "text",
      text: `\n⛔ The following images were REJECTED by the user. Penalize similar patterns heavily:`,
    });
    for (let i = 0; i < Math.min(badExamples.length, 2); i++) {
      content.push({ type: "text", text: `Rejected example ${i + 1}:` });
      try {
        content.push({
          type: "image",
          source: { type: "url", url: badExamples[i] },
        });
      } catch {
        // Skip
      }
    }
  }

  content.push({
    type: "text",
    text: `\nService item: "${itemName}" | Category: ${categoryName}. ${industryLine}\n\nScore Images 1–${candidates.length}. Output ONLY a JSON array, e.g.: [8, 2, 9]`,
  });

  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 500,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: SCORING_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }, // cache stable instructions
        },
      ],
      messages: [{ role: "user", content }],
    });

    // Find the text block (thinking blocks are separate)
    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock?.text?.trim() || "[]";
    const scores = JSON.parse(text.match(/\[[\d,\s.]+\]/)?.[0] || "[]");

    const cacheRead = response.usage?.cache_read_input_tokens || 0;
    const cacheWrite = response.usage?.cache_creation_input_tokens || 0;
    logger.info(`Claude Opus 4.8 vision scoring: ${candidates.length} images | cache_read=${cacheRead} cache_write=${cacheWrite}`);

    return scores;
  } catch (err) {
    logger.warn(`Claude vision scoring failed: ${err.message} — using neutral scores`);
    return candidates.map(() => 5);
  }
}

async function scoreWithOpenAI(candidates, itemName, categoryName, industryContext = "", badExamples = []) {
  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const industryLine = industryContext ? `Industry: ${industryContext}.` : "";

  const imageBlocks = candidates.map((c, i) => [
    { type: "text", text: `Image ${i + 1}:` },
    { type: "image_url", image_url: { url: c.thumbUrl, detail: "low" } },
  ]).flat();

  if (badExamples.length > 0) {
    badExamples.slice(0, 2).forEach((url, i) => {
      imageBlocks.push({ type: "text", text: `❌ Rejected example ${i + 1}:` });
      imageBlocks.push({ type: "image_url", image_url: { url, detail: "low" } });
    });
  }

  const prompt = `${SCORING_SYSTEM_PROMPT}\n\nItem: "${itemName}" | Category: ${categoryName}. ${industryLine}\nScore Images 1–${candidates.length}. Reply ONLY with JSON array.`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: prompt }] }],
      max_tokens: 80,
    });
    const text = res.choices[0]?.message?.content?.trim() || "[]";
    return JSON.parse(text.match(/\[[\d,\s]+\]/)?.[0] || "[]");
  } catch (err) {
    logger.warn("OpenAI vision fallback failed:", err.message);
    return candidates.map(() => 5);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Search for the top N image candidates for an item.
 * Returns array of { url, thumbUrl, domain, totalScore }
 */
function buildSearchQuery(itemName, categoryName, industryContext = "") {
  const context = industryContext || categoryName || "";
  const itemLower = itemName.toLowerCase().trim();
  const contextLower = context.toLowerCase().trim();

  // If item name is fully contained in the context term, the context is already more specific — lead with it
  if (contextLower.includes(itemLower)) {
    return `${context} installation process residential`;
  }

  // If item name is short (≤ 2 words), it's likely generic — prepend context so search stays specific
  const wordCount = itemName.trim().split(/\s+/).length;
  if (wordCount <= 2) {
    return `${context} ${itemName} installation process residential`;
  }

  // Default: item name is already specific enough to lead
  return `${itemName} ${context} installation process residential`;
}

export async function findImageCandidates(itemName, categoryName, industryContext = "", count = 3, badExamples = [], orgId = null) {
  const query = buildSearchQuery(itemName, categoryName, industryContext);

  // Load learned rules from feedback history (0 cost, instant)
  let learnedRules = null;
  if (orgId) {
    try {
      const [allFeedback, refinedModel] = await Promise.all([
        getAllFeedback(),
        loadRefinedModel(orgId),
      ]);
      learnedRules = buildLearnedRules(allFeedback, orgId, refinedModel);
      if (learnedRules.totalEntries > 0) {
        const source = refinedModel ? "Opus 4.8 refined model" : "raw feedback stats";
        logger.info(`[Learning] Applying ${learnedRules.totalEntries} entries via ${source}`);
      }
    } catch (err) {
      logger.warn(`[Learning] Could not load rules: ${err.message}`);
    }
  }

  logger.info(`Image search (${count} candidates): "${query}"${badExamples.length ? ` (excluding ${badExamples.length} rejected)` : ""}`);

  const results = await serperImageSearch(query, 10);

  const scored = results
    .map((img) => ({ ...img, progScore: scoreImageProgrammatically(img, categoryName, learnedRules) }))
    .filter((img) => img.progScore >= 0)
    .sort((a, b) => b.progScore - a.progScore);

  if (scored.length === 0) throw new Error(`No suitable images found for "${itemName}"`);

  const top = scored.slice(0, Math.min(8, scored.length));
  const visionScores = await scoreWithVision(top, itemName, categoryName, industryContext, badExamples);

  const MAX_PROG = 120; // raised because learned adjustments can add up to +40pts
  const ranked = top.map((img, i) => ({
    ...img,
    visionScore: visionScores[i] ?? 5,
    totalScore: ((img.progScore / MAX_PROG) * 10) * 0.4 + (visionScores[i] ?? 5) * 0.6,
  })).sort((a, b) => b.totalScore - a.totalScore);

  return ranked.slice(0, count);
}

/**
 * Search for the best image for an item.
 * Returns { url, thumbUrl, domain, visionScore, totalScore }
 */
export async function findBestImage(itemName, categoryName, industryContext = "", badExamples = [], orgId = null) {
  const query = buildSearchQuery(itemName, categoryName, industryContext);

  // Load learned rules (raw stats + Opus 4.8 refined model if available)
  let learnedRules = null;
  if (orgId) {
    try {
      const [allFeedback, refinedModel] = await Promise.all([
        getAllFeedback(),
        loadRefinedModel(orgId),
      ]);
      learnedRules = buildLearnedRules(allFeedback, orgId, refinedModel);
    } catch { /* proceed without */ }
  }

  logger.info(`Image search: "${query}"${badExamples.length ? ` (excluding ${badExamples.length} rejected)` : ""}`);

  // 1. Search
  const results = await serperImageSearch(query, 10);
  logger.info(`Got ${results.length} results`);

  // 2. Programmatic filter + score (with learned rules)
  const scored = results
    .map((img) => ({ ...img, progScore: scoreImageProgrammatically(img, categoryName, learnedRules) }))
    .filter((img) => img.progScore >= 0)
    .sort((a, b) => b.progScore - a.progScore);

  logger.info(`${scored.length} passed programmatic filter`);

  if (scored.length === 0) {
    throw new Error(`No suitable images found for "${itemName}"`);
  }

  // 3. Vision score top 5
  const top5 = scored.slice(0, 5);
  const visionScores = await scoreWithVision(top5, itemName, categoryName, industryContext, badExamples);

  // 4. Combine: progScore (normalized to 0-10) + visionScore
  const MAX_PROG = 80;
  const ranked = top5.map((img, i) => ({
    ...img,
    visionScore: visionScores[i] ?? 5,
    totalScore: ((img.progScore / MAX_PROG) * 10) * 0.4 + (visionScores[i] ?? 5) * 0.6,
  }));

  ranked.sort((a, b) => b.totalScore - a.totalScore);
  const winner = ranked[0];

  logger.info(`Best image: ${winner.url} (total score: ${winner.totalScore.toFixed(1)}, domain: ${winner.domain})`);
  return winner;
}

/**
 * Download an image URL and return a Buffer.
 */
export async function downloadImage(url, thumbUrlFallback = null) {
  if (url?.startsWith("/generated/")) {
    const filename = path.basename(url);
    return fs.readFile(path.join(env.GENERATED_DIR, filename));
  }

  if (url?.startsWith("/pre-generated/")) {
    // e.g. /pre-generated/org-13/item-1688.jpg
    const relativePath = url.replace(/^\/pre-generated\//, "");
    const { default: appPath } = await import("path");
    const { fileURLToPath: ftu } = await import("url");
    const base = appPath.resolve(appPath.dirname(ftu(import.meta.url)), "../pre-generated");
    return fs.readFile(appPath.join(base, relativePath));
  }

  const urlsToTry = [url];
  if (thumbUrlFallback) urlsToTry.push(thumbUrlFallback);

  let lastError = null;

  for (const tryUrl of urlsToTry) {
    try {
      const res = await fetch(tryUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Referer": "https://www.google.com/",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        lastError = new Error(`Wrong content-type: ${contentType}`);
        continue;
      }

      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastError = err;
      // Try next URL
    }
  }

  throw new Error(`Failed to download image: ${lastError?.message || "all URLs failed"}`);
}
