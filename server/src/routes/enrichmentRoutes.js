import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import {
  enrichItem,
  saveLogo,
  getLogo,
  hasLogo,
  getLogoVariants,
  deleteLogo,
  getEnrichCandidates,
  applyEnrich,
} from "../services/enrichmentService.js";
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
    const { orgId, orgName, industryContext } = req.body;
    const resolvedIndustry = industryContext || (orgName
      ? orgName.toLowerCase().replace(/\s*(pros?|experts?|services?|solutions?)\s*/gi, "").trim()
      : "");
    const result = await getEnrichCandidates(req.params.itemId, orgId || null, resolvedIndustry);
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
      size: "1024x1024",
      quality: "low",
      n: 1,
    });

    const b64 = response.data[0].b64_json;
    if (!b64) return res.status(500).json({ success: false, error: "No image returned" });

    // Save to generated dir and serve via /generated route
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

export default router;
