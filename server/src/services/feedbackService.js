import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FEEDBACK_FILE = path.resolve(__dirname, "../feedback.json");

// ── Load / Save ───────────────────────────────────────────────────────────────

async function loadFeedback() {
  try {
    const content = await fs.readFile(FEEDBACK_FILE, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    logger.warn(`Error loading feedback: ${err.message}`);
    return [];
  }
}

async function saveFeedback(feedback) {
  try {
    await fs.writeFile(FEEDBACK_FILE, JSON.stringify(feedback, null, 2));
  } catch (err) {
    logger.error(`Error saving feedback: ${err.message}`);
    throw err;
  }
}

// ── Add feedback (positive or negative) ──────────────────────────────────────

/**
 * type: "accept" | "reject"
 * feedbackReason: rejection reason key (only for type="reject")
 * source: "training" | "wizard" (where did the feedback come from)
 */
export async function addFeedback(itemId, orgId, imageUrl, feedbackReason, feedbackDetail, rating, {
  type = "reject",
  itemName = null,
  categoryName = null,
  source = "wizard",
} = {}) {
  try {
    const allFeedback = await loadFeedback();

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,           // "accept" or "reject"
      source,         // "wizard" or "training"
      itemId,
      orgId,
      itemName,
      categoryName,
      imageUrl,
      feedbackReason: feedbackReason || null,
      feedbackDetail: feedbackDetail || null,
      rating: rating || null,
      createdAt: new Date().toISOString(),
    };

    allFeedback.push(entry);
    await saveFeedback(allFeedback);

    logger.info(`📝 Feedback [${type}/${source}]: ${itemName || itemId} - ${feedbackReason || "accepted"}`);
    return entry;
  } catch (err) {
    logger.error(`Failed to add feedback: ${err.message}`);
    throw err;
  }
}

// ── Batch save (end of training session) ─────────────────────────────────────

export async function addFeedbackBatch(entries) {
  try {
    const allFeedback = await loadFeedback();

    const newEntries = entries.map((e) => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: e.type || "reject",
      source: e.source || "training",
      itemId: e.itemId,
      orgId: e.orgId,
      itemName: e.itemName || null,
      categoryName: e.categoryName || null,
      imageUrl: e.imageUrl,
      feedbackReason: e.feedbackReason || null,
      feedbackDetail: e.feedbackDetail || null,
      rating: e.rating || null,
      createdAt: new Date().toISOString(),
    }));

    allFeedback.push(...newEntries);
    await saveFeedback(allFeedback);

    const accepted = newEntries.filter((e) => e.type === "accept").length;
    const rejected = newEntries.filter((e) => e.type === "reject").length;
    logger.info(`📦 Batch feedback saved: ${accepted} accepted, ${rejected} rejected`);

    return newEntries;
  } catch (err) {
    logger.error(`Failed to save batch feedback: ${err.message}`);
    throw err;
  }
}

// ── Get rejected URLs for an item ─────────────────────────────────────────────

export async function getRejectedImageUrls(itemId, orgId) {
  try {
    const allFeedback = await loadFeedback();

    // Include rejections from BOTH wizard and training
    const rejected = allFeedback
      .filter((f) => f.type !== "accept" && f.itemId == itemId && String(f.orgId) === String(orgId))
      .map((f) => f.imageUrl);

    return new Set(rejected);
  } catch (err) {
    logger.warn(`Error getting rejected URLs: ${err.message}`);
    return new Set();
  }
}

// ── Shared base-name normalizer (strips sizes/BTU/measurements) ──────────────

export function normalizeItemBaseName(name = "") {
  return name
    .toLowerCase()
    .replace(/\b\d+(?:,\d+)?(?:\.\d+)?\s*(?:btu|kbtu|mbh|ton|tons|sq\.?\s*ft\.?|sf|lf|in\.?|ft\.?|inch(?:es)?|feet|yard(?:s)?|yd\.?|gal(?:lon)?s?|amp(?:ere)?s?|volts?|watts?|kwh|hp|cv|kw|psi|cfm)\b/gi, " ")
    .replace(/\bR[-\s]?\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*["']/g, " ")
    .replace(/\b\d+(?:\.\d+)?(?:\s*(?:x|×|by)\s*\d+(?:\.\d+)?)+\b/gi, " ")
    .replace(/\b\d+(?:,\d+)?(?:\.\d+)?\b/g, " ")
    .replace(/[-–—|,/()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Get accepted URLs from sibling items (same base name, different size) ────

export async function getAcceptedSiblingUrls(itemId, itemName, orgId) {
  try {
    const allFeedback = await loadFeedback();
    const baseName = normalizeItemBaseName(itemName);
    if (!baseName) return new Set();

    const siblingUrls = allFeedback
      .filter((f) =>
        f.type === "accept" &&
        String(f.orgId) === String(orgId) &&
        String(f.itemId) !== String(itemId) &&
        f.imageUrl &&
        normalizeItemBaseName(f.itemName || "") === baseName
      )
      .map((f) => f.imageUrl);

    return new Set(siblingUrls);
  } catch {
    return new Set();
  }
}

// ── Get positive examples for vision scoring ─────────────────────────────────
// Returns thumbUrls of accepted images (limited to avoid token bloat)

export async function getAcceptedExamples(categoryName, limit = 2) {
  try {
    const allFeedback = await loadFeedback();

    const accepted = allFeedback
      .filter((f) => f.type === "accept" && f.categoryName === categoryName)
      .slice(-limit) // most recent
      .map((f) => f.imageUrl);

    return accepted;
  } catch {
    return [];
  }
}

// ── Stats for an org ───────────────────────────────────────────────────────────

export async function getFeedbackStats(orgId) {
  try {
    const allFeedback = await loadFeedback();

    const all = allFeedback.filter((f) => String(f.orgId) === String(orgId));
    const accepted = all.filter((f) => f.type === "accept");
    const rejected = all.filter((f) => f.type !== "accept");
    const training = all.filter((f) => f.source === "training");

    const byReason = {};
    const topRejectedDomains = {};

    rejected.forEach((f) => {
      if (f.feedbackReason) {
        byReason[f.feedbackReason] = (byReason[f.feedbackReason] || 0) + 1;
      }
      try {
        const domain = new URL(f.imageUrl).hostname.replace("www.", "");
        topRejectedDomains[domain] = (topRejectedDomains[domain] || 0) + 1;
      } catch {}
    });

    return {
      total: all.length,
      accepted: accepted.length,
      rejected: rejected.length,
      trainingSessions: training.length,
      byReason,
      topRejectedDomains,
    };
  } catch (err) {
    logger.warn(`Error getting feedback stats: ${err.message}`);
    return { total: 0, accepted: 0, rejected: 0, trainingSessions: 0, byReason: {}, topRejectedDomains: {} };
  }
}

export async function getAllFeedback() {
  return loadFeedback();
}
