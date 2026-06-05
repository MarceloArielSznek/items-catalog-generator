import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import archiver from "archiver";
import AdmZip from "adm-zip";
import {
  enrichItem,
  saveLogo,
  getLogo,
  hasLogo,
  getLogoVariants,
  deleteLogo,
  getEnrichCandidates,
  applyEnrich,
  listBaseImageItemIds,
  bulkApplyLogo,
  savePreGeneratedImage,
  listPreGeneratedItemIds,
  deletePreGeneratedImage,
} from "../services/enrichmentService.js";
import { getOrgConfig, setOrgConfig, setWebsiteContext } from "../services/orgConfigService.js";
import { getAllItemsForOrg, uploadItemMedia, detachMediaFromItem, updateItem } from "../services/payloadService.js";
import { extractWebsiteContext } from "../services/websiteContextService.js";
import { addFeedback, addFeedbackBatch, getFeedbackStats, getAllFeedback } from "../services/feedbackService.js";
import { buildLearnedRules, getLearningInsights, loadRefinedModel, refineWithOpus } from "../services/learningEngine.js";
import logger from "../utils/logger.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── GET /api/enrich/logos/:orgId — list all variants ────────────────────────
router.get("/logos/:orgId", async (req, res, next) => {
  try {
    const variants = await getLogoVariants(req.params.orgId);
    res.json({ success: true, data: variants.map((v) => v.variant) });
  } catch (err) { next(err); }
});

// ── GET /api/enrich/logos/:orgId/:variant — serve logo image ─────────────────
router.get("/logos/:orgId/:variant", async (req, res, next) => {
  try {
    const buf = await getLogo(req.params.orgId, req.params.variant);
    if (!buf) return res.status(404).json({ success: false, error: "Logo not found" });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    res.send(buf);
  } catch (err) { next(err); }
});

// ── POST /api/enrich/logos/:orgId/:variant — upload a variant ────────────────
router.post("/logos/:orgId/:variant", upload.single("logo"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No logo file" });
    const variant = req.params.variant;
    if (!["white", "dark", "color", "default"].includes(variant)) {
      return res.status(400).json({ success: false, error: "Invalid variant. Use: white, dark, color, default" });
    }
    await saveLogo(req.params.orgId, req.file.buffer, variant);
    res.json({ success: true, variant });
  } catch (err) { next(err); }
});

// ── DELETE /api/enrich/logos/:orgId/:variant — remove a variant ──────────────
router.delete("/logos/:orgId/:variant", async (req, res, next) => {
  try {
    await deleteLogo(req.params.orgId, req.params.variant);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Legacy single logo (backward compat) ─────────────────────────────────────
router.get("/logo/:orgId", async (req, res, next) => {
  try {
    const variants = await getLogoVariants(req.params.orgId);
    if (!variants.length) return res.status(404).json({ success: false, error: "No logo" });
    const buf = await getLogo(req.params.orgId, variants[0].variant);
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-cache");
    res.send(buf);
  } catch (err) { next(err); }
});

router.post("/logo/:orgId", upload.single("logo"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: "No logo file" });
    await saveLogo(req.params.orgId, req.file.buffer, "default");
    res.json({ success: true, message: "Logo saved as default" });
  } catch (err) { next(err); }
});

// ── POST /api/enrich/items/:itemId — enrich one item (SSE streaming) ─────────
router.post("/items/:itemId", async (req, res) => {
  const { itemId } = req.params;
  const { orgId, orgName, industryContext } = req.body;

  // Derive industry context from org name if not explicitly provided
  // e.g. "Attic Pros" → "attic insulation", "Roofing Pros" → "roofing"
  const resolvedIndustry = industryContext || (orgName
    ? orgName.toLowerCase().replace(/\s*(pros?|experts?|services?|solutions?)\s*/gi, "").trim()
    : "");

  // Server-Sent Events for real-time progress
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };

  try {
    const result = await enrichItem(
      itemId,
      orgId || null,
      (progress) => send({ type: "progress", ...progress }),
      resolvedIndustry,
    );
    send({ type: "done", ...result });
  } catch (err) {
    logger.error("Enrichment failed:", err.message);
    send({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

// ── POST /api/enrich/items/:itemId/candidates — wizard step 1 ────────────────
router.post("/items/:itemId/candidates", async (req, res, next) => {
  try {
    const { orgId, orgName, industryContext, skipWebSearch } = req.body;
    const resolvedIndustry = industryContext || (orgName
      ? orgName.toLowerCase().replace(/\s*(pros?|experts?|services?|solutions?)\s*/gi, "").trim()
      : "");
    const result = await getEnrichCandidates(req.params.itemId, orgId || null, resolvedIndustry, { skipWebSearch: !!skipWebSearch });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/enrich/items/:itemId/generate-image — AI image generation ───────
router.post("/items/:itemId/generate-image", async (req, res, next) => {
  try {
    const { itemName, categoryName } = req.body;
    if (!itemName) return res.status(400).json({ success: false, error: "itemName required" });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `Professional commercial photograph for a home services company proposal.
Service: "${itemName}"${categoryName ? ` (${categoryName})` : ""}.
Show the completed installation or the service in action at a residential property.
Clean, well-lit, real job site. No text, no logos, no watermarks.`;

    const response = await client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1536x1024",
      quality: "medium",
      n: 1,
    });

    const b64 = response.data[0].b64_json;
    if (!b64) return res.status(500).json({ success: false, error: "No image returned" });

    const { default: env } = await import("../config/env.js");
    const { default: fsSync } = await import("fs");
    const { v4: uuidv4 } = await import("uuid");
    const filename = `ai-${uuidv4()}.png`;
    const filepath = `${env.GENERATED_DIR}/${filename}`;
    fsSync.writeFileSync(filepath, Buffer.from(b64, "base64"));

    const imageUrl = `/generated/${filename}`;
    res.json({ success: true, data: { url: imageUrl, thumbUrl: imageUrl, domain: "gpt-image-1", isAI: true } });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/enrich/items/:itemId/apply — wizard final step ─────────────────
router.post("/items/:itemId/apply", async (req, res, next) => {
  try {
    const { orgId, imageUrl, description, lighting, logoPosition, logoScale, logoVariant } = req.body;
    if (!imageUrl) return res.status(400).json({ success: false, error: "imageUrl is required" });
    const result = await applyEnrich(req.params.itemId, orgId || null, {
      imageUrl, description, lighting, logoPosition, logoScale, logoVariant: logoVariant || null,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/enrich/items/batch/auto — auto-enrich multiple items ──────────
router.post("/items/batch/auto", async (req, res) => {
  const { itemIds, orgId, orgName, industryContext } = req.body;

  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ success: false, error: "itemIds array required" });
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };

  try {
    const resolvedIndustry = industryContext || (orgName
      ? orgName.toLowerCase().replace(/\s*(pros?|experts?|services?|solutions?)\s*/gi, "").trim()
      : "");

    const results = [];
    for (let i = 0; i < itemIds.length; i++) {
      const itemId = itemIds[i];
      try {
        send({ type: "progress", current: i, total: itemIds.length, itemId, status: "processing" });

        // Get candidates with smart suggestions
        const enrichData = await getEnrichCandidates(itemId, orgId || null, resolvedIndustry);

        // Get the best image automatically
        const bestImage = enrichData.candidates && enrichData.candidates[0];
        if (!bestImage) {
          send({ type: "log", message: `⚠️ No images found for item ${itemId}` });
          continue;
        }

        // Apply enrichment automatically with smart defaults
        await applyEnrich(itemId, orgId || null, {
          imageUrl: bestImage.url,
          description: enrichData.description,
          lighting: { brightness: 1, contrast: 1, saturation: 1, warmth: 0 },
          logoPosition: null, // auto-detect on server
          logoScale: 0.25,
          logoVariant: null, // auto-select on server
          thumbUrlFallback: bestImage.thumbUrl, // Fallback if main URL fails
        });

        send({ type: "log", message: `✅ Enriched: ${itemId}` });
        results.push({ itemId, status: "success" });
      } catch (err) {
        send({ type: "log", message: `❌ Failed: ${itemId} - ${err.message}` });
        results.push({ itemId, status: "failed", error: err.message });
      }
    }

    send({ type: "done", message: "Auto-enrich completed!", results });
  } catch (err) {
    logger.error("Auto-enrich failed:", err.message);
    send({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

// ── GET /api/enrich/proxy?url=... — CORS proxy for image previews ─────────────
router.get("/proxy", async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).send("url required");

    const response = await fetch(decodeURIComponent(url), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CatalogBot/1.0)" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) return res.status(response.status).send("Failed to fetch");

    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");
    res.set("Access-Control-Allow-Origin", "*");

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── POST /api/enrich/feedback — save single feedback ──────────────────────────
router.post("/feedback", async (req, res, next) => {
  try {
    const { itemId, orgId, imageUrl, feedbackReason, feedbackDetail, rating, type, itemName, categoryName, source } = req.body;

    if (!itemId || !orgId || !imageUrl) {
      return res.status(400).json({ success: false, error: "itemId, orgId, imageUrl required" });
    }

    const entry = await addFeedback(itemId, orgId, imageUrl, feedbackReason, feedbackDetail, rating, {
      type: type || "reject",
      itemName,
      categoryName,
      source: source || "wizard",
    });
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/enrich/feedback/batch — save training session results ────────────
router.post("/feedback/batch", async (req, res, next) => {
  try {
    const { entries } = req.body;
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, error: "entries array required" });
    }
    const saved = await addFeedbackBatch(entries);
    res.json({ success: true, data: saved, count: saved.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/enrich/feedback/stats?orgId=... ───────────────────────────────────
router.get("/feedback/stats", async (req, res, next) => {
  try {
    const { orgId } = req.query;
    if (!orgId) return res.status(400).json({ success: false, error: "orgId required" });
    const stats = await getFeedbackStats(orgId);
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/enrich/feedback/learning?orgId=... — what the system has learned ─
router.get("/feedback/learning", async (req, res, next) => {
  try {
    const { orgId } = req.query;
    if (!orgId) return res.status(400).json({ success: false, error: "orgId required" });
    const [allFeedback, refinedModel] = await Promise.all([
      getAllFeedback(),
      loadRefinedModel(orgId),
    ]);
    const rules = buildLearnedRules(allFeedback, orgId, refinedModel);
    const insights = getLearningInsights(rules);
    res.json({ success: true, data: { insights, rules, refinedModel } });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/enrich/feedback/refine — run Opus 4.8 analysis ──────────────────
router.post("/feedback/refine", async (req, res, next) => {
  try {
    const { orgId, orgName } = req.body;
    if (!orgId) return res.status(400).json({ success: false, error: "orgId required" });

    const allFeedback = await getAllFeedback();
    const model = await refineWithOpus(allFeedback, orgId, orgName);

    res.json({
      success: true,
      data: {
        summary: model.summary,
        domainsScored: Object.keys(model.domainScores || {}).length,
        blockedDomains: model.blockedDomains || [],
        trustedDomains: model.trustedDomains || [],
        confidenceLevel: model.confidenceLevel,
        inputTokens: model.inputTokens,
        outputTokens: model.outputTokens,
        generatedAt: model.generatedAt,
      },
    });
  } catch (err) {
    // Don't use next(err) — return a user-friendly message
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── GET /api/enrich/feedback/all?orgId=... — full log for insights panel ───────
router.get("/feedback/all", async (req, res, next) => {
  try {
    const { orgId } = req.query;
    const all = await getAllFeedback();
    const filtered = orgId ? all.filter((e) => String(e.orgId) === String(orgId)) : all;
    // Sort newest first
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, data: filtered, total: filtered.length });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/enrich/training/random-items — pick random unreviewed items ───────
router.get("/training/random-items", async (req, res, next) => {
  try {
    const { orgId, count = 10 } = req.query;
    if (!orgId) return res.status(400).json({ success: false, error: "orgId required" });

    const { getItemsForTraining } = await import("../services/enrichmentService.js");
    const items = await getItemsForTraining(orgId, parseInt(count));
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/enrich/org-config/:orgId ─────────────────────────────────────────
router.get("/org-config/:orgId", async (req, res, next) => {
  try {
    const config = await getOrgConfig(req.params.orgId);
    res.json({ success: true, data: config });
  } catch (err) { next(err); }
});

// ── PUT /api/enrich/org-config/:orgId ─────────────────────────────────────────
router.put("/org-config/:orgId", async (req, res, next) => {
  try {
    const { isDemoOrg, websiteUrl } = req.body;
    const fields = {};
    if (typeof isDemoOrg === "boolean") fields.isDemoOrg = isDemoOrg;
    if (websiteUrl !== undefined) fields.websiteUrl = websiteUrl || null;
    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ success: false, error: "No valid fields provided" });
    }
    const config = await setOrgConfig(req.params.orgId, fields);
    res.json({ success: true, data: config });
  } catch (err) { next(err); }
});

// ── GET /api/enrich/base-images ───────────────────────────────────────────────
router.get("/base-images", async (req, res, next) => {
  try {
    const itemIds = await listBaseImageItemIds();
    res.json({ success: true, data: itemIds });
  } catch (err) { next(err); }
});

// ── POST /api/enrich/bulk-apply-logo ──────────────────────────────────────────
router.post("/bulk-apply-logo", async (req, res, next) => {
  try {
    const { orgId, itemIds } = req.body;
    if (!orgId || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ success: false, error: "orgId and itemIds[] required" });
    }
    const results = await bulkApplyLogo(orgId, itemIds);
    res.json({ success: true, data: results });
  } catch (err) { next(err); }
});

// ── POST /api/enrich/website-context/:orgId — scrape + extract context ────────
router.post("/website-context/:orgId", async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const config = await getOrgConfig(orgId);
    if (!config.websiteUrl) {
      return res.status(400).json({ success: false, error: "No website URL set for this org" });
    }
    const context = await extractWebsiteContext(config.websiteUrl);
    await setWebsiteContext(orgId, context);
    res.json({ success: true, data: context });
  } catch (err) { next(err); }
});

// ── GET /api/enrich/pre-generated/:orgId — list item IDs with AI images ───────
router.get("/pre-generated/:orgId", async (req, res, next) => {
  try {
    const itemIds = await listPreGeneratedItemIds(req.params.orgId);
    res.json({ success: true, data: itemIds });
  } catch (err) { next(err); }
});

// ── DELETE /api/enrich/pre-generated/:orgId/:itemId — remove a pre-gen image ──
router.delete("/pre-generated/:orgId/:itemId", async (req, res, next) => {
  try {
    await deletePreGeneratedImage(req.params.orgId, req.params.itemId);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── POST /api/enrich/ai-catalog — bulk AI image generation (SSE) ──────────────
router.post("/ai-catalog", async (req, res) => {
  const { orgId, orgName, itemIds, force = false, quality = "medium" } = req.body;

  if (!orgId || !Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ success: false, error: "orgId and itemIds[] required" });
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };

  try {
    // 1. Load or fetch website context
    send({ type: "progress", step: "context", message: "Loading company context…", current: 0, total: itemIds.length });
    let config = await getOrgConfig(orgId);
    let websiteContext = config.websiteContext;

    if (!websiteContext && config.websiteUrl) {
      send({ type: "progress", step: "context", message: `Scanning ${config.websiteUrl}…`, current: 0, total: itemIds.length });
      websiteContext = await extractWebsiteContext(config.websiteUrl);
      await setWebsiteContext(orgId, websiteContext);
    }

    const industry = websiteContext?.industry || "home services";
    const visualStyle = websiteContext?.visualStyle || "clean professional residential";
    const targetMarket = websiteContext?.targetMarket || "residential homeowners";
    const companyContext = `${industry}. Style: ${visualStyle}. Market: ${targetMarket}.`;

    // 2. Filter out items that already have a pre-generated image (unless force=true)
    const { getItem } = await import("../services/payloadService.js");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const existingIds = new Set(await listPreGeneratedItemIds(orgId));
    const toGenerate = force
      ? itemIds
      : itemIds.filter(id => !existingIds.has(String(id)));
    const skipped = itemIds.length - toGenerate.length;

    if (skipped > 0) {
      send({ type: "progress", step: "skip", message: `Skipping ${skipped} item${skipped !== 1 ? "s" : ""} that already have images.`, current: 0, total: toGenerate.length });
    }

    if (toGenerate.length === 0) {
      send({ type: "done", results: [], succeeded: 0, failed: 0, skipped });
      return res.end();
    }

    const results = [];

    for (let i = 0; i < toGenerate.length; i++) {
      const itemId = toGenerate[i];
      try {
        send({ type: "progress", step: "generating", message: `Generating image ${i + 1} of ${toGenerate.length}…`, current: i, total: toGenerate.length, itemId });

        // Fetch item name + category from Payload
        const itemRes = await getItem(itemId);
        const item = itemRes.data || itemRes;
        const itemName = item.name || `Item ${itemId}`;
        const categoryName = item.category?.title || item.category?.name || "";

        // Ask GPT-4o-mini to write the optimal DALL-E prompt
        const promptMsg = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 256,
          messages: [{
            role: "user",
            content: `Write an image generation prompt for a home services catalog photo.

Company context: ${companyContext}
Item: "${itemName}"
Category: "${categoryName}"

STRICT rules — include these exact phrases in the prompt:
- "no text, no words, no letters, no labels, no captions, no watermarks, no overlays"
- "no human hands, no people, no faces, no body parts"
- "photorealistic professional photograph"
- "residential home interior or exterior"
- "natural lighting, clean composition"

Focus the image on the EQUIPMENT, RESULT, or ENVIRONMENT — not on people performing the service.
Example good subjects: installed equipment, clean ducts, finished attic, tools laid out, before/after environment.

Write ONLY the prompt text, nothing else. Max 120 words.`,
          }],
        });

        const dallePrompt = promptMsg.choices[0].message.content.trim();

        // Generate with gpt-image-1
        const imageRes = await openai.images.generate({
          model: "gpt-image-1",
          prompt: dallePrompt,
          size: "1536x1024",
          quality: ["low", "medium", "high"].includes(quality) ? quality : "medium",
          n: 1,
        });

        const b64 = imageRes.data[0].b64_json;
        const buffer = Buffer.from(b64, "base64");

        await savePreGeneratedImage(orgId, itemId, buffer);

        logger.info(`AI catalog: generated image for itemId=${itemId} (${itemName})`);
        results.push({ itemId, itemName, status: "success" });
        send({ type: "progress", step: "done-item", message: `✓ ${itemName}`, current: i + 1, total: toGenerate.length, itemId, status: "success" });

      } catch (err) {
        logger.warn(`AI catalog: failed itemId=${itemId}: ${err.message}`);
        results.push({ itemId, status: "error", error: err.message });
        send({ type: "progress", step: "done-item", message: `✗ Item ${itemId}: ${err.message}`, current: i + 1, total: toGenerate.length, itemId, status: "error" });
      }
    }

    send({ type: "done", results, succeeded: results.filter(r => r.status === "success").length, failed: results.filter(r => r.status === "error").length, skipped });
  } catch (err) {
    logger.error("AI catalog generation failed:", err.message);
    send({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

// ── GET /api/enrich/export-package/:orgId — ZIP of all enriched items ─────────
router.get("/export-package/:orgId", async (req, res) => {
  const { orgId } = req.params;
  try {
    const allItems = await getAllItemsForOrg(orgId);
    const enriched = allItems.filter((item) => {
      const media = item.media;
      return media && (Array.isArray(media) ? media.length > 0 : true);
    });

    if (enriched.length === 0) {
      return res.status(404).json({ success: false, error: "No enriched items found for this org" });
    }

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="enrichment-org-${orgId}.zip"`,
    });

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => { logger.error("Archive error:", err.message); });
    archive.pipe(res);

    const manifest = [];

    for (const item of enriched) {
      const mediaItem = Array.isArray(item.media) ? item.media[0] : item.media;
      const relUrl = mediaItem?.url || mediaItem?.sizes?.thumbnail?.url;
      if (!relUrl) continue;

      // Media URLs from /v1 are absolute S3 publicUrls; fall back to the API base
      // only for any legacy relative path.
      const fullUrl = relUrl.startsWith("http")
        ? relUrl
        : `${(await import("../config/env.js")).default.MENAIA_API_URL}${relUrl}`;

      try {
        const imgRes = await fetch(fullUrl, { signal: AbortSignal.timeout(15000) });
        if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const slug = (item.name || `item-${item.id}`)
          .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const imageFile = `images/${slug}.jpg`;

        archive.append(buf, { name: imageFile });
        manifest.push({ itemName: item.name || "", description: item.itemInfo || "", imageFile });
      } catch (err) {
        logger.warn(`Export: skipping item ${item.id} (${item.name}): ${err.message}`);
      }
    }

    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
    await archive.finalize();
  } catch (err) {
    if (!res.headersSent) {
      logger.error("Export package failed:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// ── POST /api/enrich/apply-package/:orgId — import ZIP to current Payload org ─
router.post("/apply-package/:orgId", upload.single("package"), async (req, res, next) => {
  try {
    const { orgId } = req.params;
    if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });

    const zip = new AdmZip(req.file.buffer);
    const manifestEntry = zip.getEntry("manifest.json");
    if (!manifestEntry) return res.status(400).json({ success: false, error: "Invalid package: missing manifest.json" });

    const manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
    const allItems = await getAllItemsForOrg(orgId);

    const itemByName = new Map();
    for (const item of allItems) {
      itemByName.set((item.name || "").toLowerCase().trim(), item);
    }

    const results = { applied: [], notFound: [], failed: [] };

    for (const entry of manifest) {
      const normalizedName = (entry.itemName || "").toLowerCase().trim();
      const item = itemByName.get(normalizedName);

      if (!item) {
        results.notFound.push(entry.itemName);
        continue;
      }

      try {
        const imageEntry = zip.getEntry(entry.imageFile);
        if (!imageEntry) throw new Error("Image not found in package");
        const imageBuffer = imageEntry.getData();

        // Remove existing media
        const existingMedia = Array.isArray(item.media) ? item.media : item.media ? [item.media] : [];
        for (const m of existingMedia) {
          const mid = typeof m === "object" ? m.id : m;
          if (mid) await detachMediaFromItem(item.id, mid).catch(() => {});
        }

        const filename = `${(item.name || "item").replace(/\s+/g, "-").toLowerCase()}-enriched.jpg`;
        await uploadItemMedia(item.id, imageBuffer, filename, "image/jpeg");
        if (entry.description) await updateItem(item.id, { itemInfo: entry.description });

        results.applied.push(entry.itemName);
      } catch (err) {
        results.failed.push({ itemName: entry.itemName, error: err.message });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

export default router;
