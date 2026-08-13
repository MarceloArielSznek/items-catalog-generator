/**
 * Local Learning Engine
 * ─────────────────────
 * Analyzes accumulated user feedback (accept/reject) to extract
 * patterns and produce learned scoring rules — 100% local, no API calls.
 *
 * The more feedback you provide via the Training Wizard, the smarter it gets.
 */

import logger from "../utils/logger.js";

// URL substrings that strongly suggest a bad image (team/promo photos)
const NEGATIVE_URL_KEYWORDS = [
  "team", "crew", "staff", "about-us", "about_us", "our-team",
  "people", "headshot", "portrait", "company", "meet-us",
];

// URL substrings that suggest a good service/installation photo
const POSITIVE_URL_KEYWORDS = [
  "install", "service", "repair", "attic", "crawl", "duct",
  "hvac", "insul", "roof", "plumb", "electric", "work",
  "job", "residential", "home",
];

// ─── Core Analysis ────────────────────────────────────────────────────────────

/**
 * Analyzes all feedback for an org and returns learned rules.
 * Call this once per request cycle (not per image).
 */
export function buildLearnedRules(allFeedback, orgId, refinedModel = null) {
  const entries = allFeedback.filter(
    (f) => String(f.orgId) === String(orgId) && f.imageUrl,
  );

  if (entries.length === 0) {
    return {
      domainStats: {},
      categoryDomainStats: {},
      rejectionReasonUrls: {},
      totalEntries: 0,
    };
  }

  // ── Domain stats ─────────────────────────────────────────────────────────────
  const domainStats = {}; // domain → { accepts, rejects, total, rate }
  const categoryDomainStats = {}; // category → domain → { accepts, rejects }

  for (const entry of entries) {
    let domain = "";
    try {
      domain = new URL(entry.imageUrl).hostname.replace("www.", "");
    } catch { continue; }

    const isAccept = entry.type === "accept";

    // Global domain stats
    if (!domainStats[domain]) domainStats[domain] = { accepts: 0, rejects: 0 };
    if (isAccept) domainStats[domain].accepts++;
    else domainStats[domain].rejects++;

    // Per-category domain stats
    const cat = (entry.categoryName || "").toLowerCase();
    if (cat) {
      if (!categoryDomainStats[cat]) categoryDomainStats[cat] = {};
      if (!categoryDomainStats[cat][domain]) {
        categoryDomainStats[cat][domain] = { accepts: 0, rejects: 0 };
      }
      if (isAccept) categoryDomainStats[cat][domain].accepts++;
      else categoryDomainStats[cat][domain].rejects++;
    }
  }

  // Compute acceptance rates
  for (const domain of Object.keys(domainStats)) {
    const s = domainStats[domain];
    s.total = s.accepts + s.rejects;
    s.rate = s.total > 0 ? s.accepts / s.total : 0.5;
  }

  // ── Rejection reason patterns ─────────────────────────────────────────────
  // Track which reason+domain combos appear most
  const rejectionReasonUrls = {}; // reason → [urls]
  for (const entry of entries.filter((e) => e.type !== "accept" && e.feedbackReason)) {
    if (!rejectionReasonUrls[entry.feedbackReason]) {
      rejectionReasonUrls[entry.feedbackReason] = [];
    }
    rejectionReasonUrls[entry.feedbackReason].push(entry.imageUrl);
  }

  logger.info(
    `[LearningEngine] Org ${orgId}: ${entries.length} feedback entries → ` +
    `${Object.keys(domainStats).length} domains learned`,
  );

  return {
    domainStats,
    categoryDomainStats,
    rejectionReasonUrls,
    totalEntries: entries.length,
    refinedModel, // Opus 4.8 model attached if available
  };
}

// ─── Scoring Functions ────────────────────────────────────────────────────────

/**
 * Returns a score adjustment (-40 to +30) based on learned domain history.
 * Needs at least 3 samples for a domain before applying adjustments.
 */
export function getLearnedDomainScore(domain, categoryName, rules) {
  const MIN_SAMPLES = 3;

  // ── Refined model (Opus 4.8) takes priority ────────────────────────────────
  const rm = rules?.refinedModel;
  if (rm) {
    // Hard block from Opus analysis
    if (rm.blockedDomains?.includes(domain)) {
      return { adjustment: -999, source: "opus-blocked" }; // will trigger disqualify
    }
    // Category-specific overrides
    const cat = (categoryName || "").toLowerCase();
    for (const [rCat, rRules] of Object.entries(rm.categoryRules || {})) {
      if (cat.includes(rCat.toLowerCase())) {
        if (rRules.blockDomains?.includes(domain)) {
          return { adjustment: -999, source: "opus-cat-blocked" };
        }
        if (rRules.boostDomains?.includes(domain)) {
          return { adjustment: 25, source: "opus-cat-boost" };
        }
      }
    }
    // Global domain score from Opus
    if (rm.domainScores?.[domain] !== undefined) {
      return { adjustment: rm.domainScores[domain], source: "opus-refined" };
    }
  }

  // ── Fallback: raw feedback stats ───────────────────────────────────────────
  const cat = (categoryName || "").toLowerCase();

  // Try category-specific first (more precise)
  const catDomains = rules.categoryDomainStats?.[cat];
  if (catDomains?.[domain]) {
    const s = catDomains[domain];
    const total = s.accepts + s.rejects;
    if (total >= MIN_SAMPLES) {
      const rate = s.accepts / total;
      adjustment = domainRateToScore(rate, total);
      return { adjustment, source: "category-learned", rate, samples: total };
    }
  }

  // Fall back to global domain stats
  const global = rules.domainStats?.[domain];
  if (global && global.total >= MIN_SAMPLES) {
    adjustment = domainRateToScore(global.rate, global.total);
    return { adjustment, source: "global-learned", rate: global.rate, samples: global.total };
  }

  return { adjustment: 0, source: "unknown" };
}

/**
 * Converts domain acceptance rate → point adjustment.
 * More samples = more confidence = larger adjustment.
 */
function domainRateToScore(rate, samples) {
  // Confidence multiplier: more samples = stronger signal
  const confidence = Math.min(samples / 10, 1.0); // maxes out at 10 samples

  if (rate >= 0.85)  return Math.round(+25 * confidence); // almost always good
  if (rate >= 0.70)  return Math.round(+15 * confidence); // usually good
  if (rate >= 0.55)  return Math.round(+5  * confidence); // slightly good
  if (rate >= 0.45)  return 0;                            // neutral
  if (rate >= 0.30)  return Math.round(-10 * confidence); // usually bad
  if (rate >= 0.15)  return Math.round(-25 * confidence); // often bad
  return              Math.round(-40 * confidence);         // almost always bad
}

/**
 * Returns a score adjustment based on URL keywords.
 * No training data needed — applies immediately.
 */
export function getUrlKeywordScore(url) {
  const urlLower = (url || "").toLowerCase();
  let score = 0;

  for (const kw of NEGATIVE_URL_KEYWORDS) {
    if (urlLower.includes(kw)) {
      score -= 8;
      break; // only penalize once
    }
  }

  for (const kw of POSITIVE_URL_KEYWORDS) {
    if (urlLower.includes(kw)) {
      score += 5;
      break; // only reward once
    }
  }

  return score;
}

/**
 * Returns a score adjustment based on title keywords.
 */
export function getTitleKeywordScore(title) {
  const t = (title || "").toLowerCase();
  let score = 0;

  const negativeTitle = [
    "team", "crew", "staff", "our team", "meet the", "company", "employees",
    "headshot", "portrait", "group photo", "workers posing",
  ];
  const positiveTitle = [
    "installation", "install", "service", "repair", "work", "job site",
    "residential", "attic", "crawl space", "duct", "hvac", "insulation",
  ];

  for (const kw of negativeTitle) {
    if (t.includes(kw)) { score -= 10; break; }
  }

  for (const kw of positiveTitle) {
    if (t.includes(kw)) { score += 8; break; }
  }

  return score;
}

// ─── Stats & Insights ─────────────────────────────────────────────────────────

/**
 * Returns human-readable insights about what the system has learned.
 */
export function getLearningInsights(rules) {
  const { domainStats, totalEntries } = rules;

  const trusted = [];
  const blocked = [];
  const learning = [];

  for (const [domain, stats] of Object.entries(domainStats)) {
    if (stats.total < 3) {
      learning.push({ domain, samples: stats.total });
    } else if (stats.rate >= 0.7) {
      trusted.push({ domain, rate: stats.rate, samples: stats.total });
    } else if (stats.rate <= 0.3) {
      blocked.push({ domain, rate: stats.rate, samples: stats.total });
    }
  }

  trusted.sort((a, b) => b.rate - a.rate);
  blocked.sort((a, b) => a.rate - b.rate);

  return {
    totalEntries,
    domainsLearned: Object.keys(domainStats).length,
    trusted: trusted.slice(0, 5),
    blocked: blocked.slice(0, 5),
    stillLearning: learning.length,
    maturity: totalEntries < 10
      ? "early"
      : totalEntries < 50
        ? "growing"
        : "mature",
  };
}


// ─── Opus 4.8 Refinement ─────────────────────────────────────────────────────

import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import env from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "../learned-models");

function modelPath(orgId) {
  return path.join(MODELS_DIR, `org-${orgId}.json`);
}

/**
 * Load a previously refined model for an org (if it exists).
 */
export async function loadRefinedModel(orgId) {
  try {
    const raw = await fs.readFile(modelPath(orgId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save the refined model produced by Opus 4.8.
 */
async function saveRefinedModel(orgId, model) {
  await fs.mkdir(MODELS_DIR, { recursive: true });
  await fs.writeFile(modelPath(orgId), JSON.stringify(model, null, 2));
}

/**
 * Send accumulated feedback to Claude Opus 4.8 for deep analysis.
 * Returns a refined model and saves it locally.
 *
 * This is the ONE paid call — analyze once, apply forever.
 */
export async function refineWithOpus(allFeedback, orgId, orgName) {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set — add it to server/.env");
  }

  const entries = allFeedback.filter((f) => String(f.orgId) === String(orgId));
  if (entries.length < 5) {
    throw new Error("Need at least 5 feedback entries to refine. Keep training!");
  }

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  // Build a structured summary of the feedback for Claude to analyze
  const accepted = entries.filter((e) => e.type === "accept");
  const rejected = entries.filter((e) => e.type !== "accept");

  const domainSummary = {};
  for (const e of entries) {
    let domain = "";
    try { domain = new URL(e.imageUrl).hostname.replace("www.", ""); } catch { continue; }
    if (!domainSummary[domain]) domainSummary[domain] = { accepts: 0, rejects: 0, reasons: [] };
    if (e.type === "accept") domainSummary[domain].accepts++;
    else {
      domainSummary[domain].rejects++;
      if (e.feedbackReason) domainSummary[domain].reasons.push(e.feedbackReason);
    }
  }

  const categorySummary = {};
  for (const e of entries) {
    const cat = e.categoryName || "Unknown";
    if (!categorySummary[cat]) categorySummary[cat] = { accepts: 0, rejects: 0, acceptedDomains: [], rejectedDomains: [] };
    let domain = "";
    try { domain = new URL(e.imageUrl).hostname.replace("www.", ""); } catch {}
    if (e.type === "accept") {
      categorySummary[cat].accepts++;
      if (domain) categorySummary[cat].acceptedDomains.push(domain);
    } else {
      categorySummary[cat].rejects++;
      if (domain) categorySummary[cat].rejectedDomains.push(domain);
    }
  }

  const rejectionReasons = {};
  for (const e of rejected) {
    if (e.feedbackReason) {
      rejectionReasons[e.feedbackReason] = (rejectionReasons[e.feedbackReason] || 0) + 1;
    }
  }

  const prompt = `You are analyzing image selection feedback from a home services company catalog curator.
Company: "${orgName || orgId}"
Industry: Home services (attic insulation, HVAC, duct cleaning, crawl space, etc.)

FEEDBACK SUMMARY:
- Total entries: ${entries.length}
- Accepted: ${accepted.length}
- Rejected: ${rejected.length}

DOMAIN PERFORMANCE:
${JSON.stringify(domainSummary, null, 2)}

REJECTION REASONS:
${JSON.stringify(rejectionReasons, null, 2)}

CATEGORY-SPECIFIC PATTERNS:
${JSON.stringify(categorySummary, null, 2)}

Based on this data, generate a refined scoring model as a JSON object with this exact structure:
{
  "version": 1,
  "generatedAt": "ISO date",
  "orgId": "${orgId}",
  "summary": "2-3 sentence summary of what you learned about this org's preferences",
  "domainScores": {
    "domain.com": <integer -40 to +30>
  },
  "blockedDomains": ["domain1.com"],
  "trustedDomains": ["domain1.com"],
  "categoryRules": {
    "category name": {
      "boostDomains": ["domain.com"],
      "blockDomains": ["domain.com"],
      "notes": "what works for this category"
    }
  },
  "urlKeywordsPositive": ["keyword1"],
  "urlKeywordsNegative": ["keyword1"],
  "mainRejectionPattern": "one sentence about the most common rejection reason",
  "confidenceLevel": "low|medium|high"
}

Rules for scoring:
- Domain score +25 to +30: almost always produces good images (accept rate >85%)
- Domain score +10 to +20: usually good (70-85%)
- Domain score 0: neutral or insufficient data
- Domain score -10 to -20: often bad (30-50%)
- Domain score -25 to -40: almost always bad (<30%)
- blockedDomains: domains with accept rate <15% AND 5+ samples
- trustedDomains: domains with accept rate >80% AND 3+ samples

Output ONLY the JSON object, no explanation before or after.`;

  logger.info(`[GPT-4o] Sending ${entries.length} feedback entries for refinement...`);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0].message.content;
  if (!text) throw new Error("GPT-4o returned no content");

  const jsonMatch = text.match(/\{[\s\S]+\}/);
  if (!jsonMatch) throw new Error("Could not parse JSON from GPT-4o response");

  const refinedModel = JSON.parse(jsonMatch[0]);
  refinedModel.generatedAt = new Date().toISOString();
  refinedModel.orgId = orgId;
  refinedModel.inputTokens = response.usage?.prompt_tokens || 0;
  refinedModel.outputTokens = response.usage?.completion_tokens || 0;

  await saveRefinedModel(orgId, refinedModel);

  logger.info(
    `[GPT-4o] Refinement complete — ` +
    `${Object.keys(refinedModel.domainScores || {}).length} domains scored, ` +
    `confidence: ${refinedModel.confidenceLevel}`
  );

  return refinedModel;
}
