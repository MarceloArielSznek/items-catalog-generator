import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import env from "../config/env.js";
import logger from "../utils/logger.js";

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
      q: `${query} -watermark -amazon -ebay -packaging`,
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

function scoreImageProgrammatically(img) {
  let score = 0;

  // Disqualify blacklisted domains
  if (BLACKLISTED_DOMAINS.some((d) => img.domain.includes(d))) return -1;

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

  // Preferred domain (max 20pts)
  if (PREFERRED_DOMAINS.some((d) => img.domain.includes(d))) score += 20;

  // URL cleanliness — avoid URLs with "watermark", "sample", "preview"
  const urlLower = img.url.toLowerCase();
  if (urlLower.includes("watermark") || urlLower.includes("sample") || urlLower.includes("preview")) {
    return -1;
  }

  return score;
}

// ── Vision scoring via GPT-4o-mini ───────────────────────────────────────────

async function scoreWithVision(candidates, itemName, categoryName, industryContext = "") {
  if (!env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
  if (candidates.length === 0) return [];

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const imageBlocks = candidates.map((c, i) => [
    { type: "text", text: `Image ${i + 1}:` },
    { type: "image_url", image_url: { url: c.thumbUrl, detail: "low" } },
  ]).flat();

  const industryLine = industryContext ? `Industry: ${industryContext}.` : "";

  const prompt = `You are selecting the best photo for a professional home services company catalog.
Item: "${itemName}" | Category: ${categoryName}. ${industryLine}

Rate each image 1-10. Score HIGH for:
✅ Shows the actual service being performed OR the result after installation
✅ Real job site or home environment (attic, roof, crawl space, etc.)
✅ Professional quality, no distracting elements
✅ No visible manufacturer branding, price tags, or retail packaging

Score LOW for:
❌ Amazon/retail-style product shot on white background
❌ Visible brand names or product labels prominently shown
❌ Unrelated content
❌ Watermarks, overlaid text

Reply ONLY with a JSON array of scores, e.g.: [7, 3, 9, 5, 8]`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: prompt },
          ],
        },
      ],
      max_tokens: 60,
    });

    const text = response.choices[0]?.message?.content?.trim() || "[]";
    const scores = JSON.parse(text.match(/\[[\d,\s]+\]/)?.[0] || "[]");
    return scores;
  } catch (err) {
    logger.warn("Vision scoring failed, falling back to programmatic only:", err.message);
    return candidates.map(() => 5); // neutral fallback
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Search for the top N image candidates for an item.
 * Returns array of { url, thumbUrl, domain, totalScore }
 */
export async function findImageCandidates(itemName, categoryName, industryContext = "", count = 3) {
  const contextTerm = industryContext || categoryName;
  const query = `${itemName} ${contextTerm} installation service professional`;
  logger.info(`Image search (${count} candidates): "${query}"`);

  const results = await serperImageSearch(query, 10);

  const scored = results
    .map((img) => ({ ...img, progScore: scoreImageProgrammatically(img) }))
    .filter((img) => img.progScore >= 0)
    .sort((a, b) => b.progScore - a.progScore);

  if (scored.length === 0) throw new Error(`No suitable images found for "${itemName}"`);

  const top = scored.slice(0, Math.min(8, scored.length));
  const visionScores = await scoreWithVision(top, itemName, categoryName, industryContext);

  const MAX_PROG = 80;
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
export async function findBestImage(itemName, categoryName, industryContext = "") {
  // Build a contextual query: prefer installation/service photos over product shots
  const contextTerm = industryContext || categoryName;
  const query = `${itemName} ${contextTerm} installation service professional`;
  logger.info(`Image search: "${query}"`);

  // 1. Search
  const results = await serperImageSearch(query, 10);
  logger.info(`Got ${results.length} results`);

  // 2. Programmatic filter + score
  const scored = results
    .map((img) => ({ ...img, progScore: scoreImageProgrammatically(img) }))
    .filter((img) => img.progScore >= 0)
    .sort((a, b) => b.progScore - a.progScore);

  logger.info(`${scored.length} passed programmatic filter`);

  if (scored.length === 0) {
    throw new Error(`No suitable images found for "${itemName}"`);
  }

  // 3. Vision score top 5
  const top5 = scored.slice(0, 5);
  const visionScores = await scoreWithVision(top5, itemName, categoryName, industryContext);

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
export async function downloadImage(url) {
  if (url?.startsWith("/generated/")) {
    const filename = path.basename(url);
    return fs.readFile(path.join(env.GENERATED_DIR, filename));
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CatalogBot/1.0)",
      Accept: "image/*",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Unexpected content type: ${contentType}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
