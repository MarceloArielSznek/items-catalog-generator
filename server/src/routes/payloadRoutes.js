import { Router } from "express";
import fs from "fs/promises";
import multer from "multer";
import env from "../config/env.js";
import SmartStorage from "../middleware/smartStorage.js";
import { isAllowedMediaMimeType } from "../utils/fileValidation.js";
import {
  getWorkAreas,
  getWorkArea,
  createWorkArea,
  updateWorkArea,
  deleteWorkArea,
  getCategoriesByWorkArea,
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  getItemsByCategory,
  getAllItems,
  getItem,
  updateItem,
  uploadMedia,
  attachMediaToItem,
  detachMediaFromItem,
  getFactors,
  getAdditionalCosts,
  getOrganizations,
} from "../services/payloadService.js";
import { SMART_STORAGE_THRESHOLD_MB } from "../../../shared/constants/imageRules.js";

const router = Router();

const mediaUpload = multer({
  storage: new SmartStorage({
    threshold: SMART_STORAGE_THRESHOLD_MB * 1024 * 1024,
    destination: env.UPLOAD_DIR,
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, isAllowedMediaMimeType(file.mimetype));
  },
  limits: { fileSize: env.MAX_MEDIA_SIZE_BYTES },
});

router.get("/work-areas", async (_req, res, next) => {
  try {
    const workAreas = await getWorkAreas();
    res.json({ success: true, data: workAreas });
  } catch (err) {
    next(err);
  }
});

router.get("/work-areas/:id", async (req, res, next) => {
  try {
    const workArea = await getWorkArea(req.params.id);
    res.json({ success: true, data: workArea });
  } catch (err) {
    next(err);
  }
});

router.post("/work-areas", async (req, res, next) => {
  try {
    const result = await createWorkArea(req.body || {});
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.patch("/work-areas/:id", async (req, res, next) => {
  try {
    const result = await updateWorkArea(req.params.id, req.body || {});
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.delete("/work-areas/:id", async (req, res, next) => {
  try {
    await deleteWorkArea(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/work-areas/:id/categories", async (req, res, next) => {
  try {
    const categories = await getCategoriesByWorkArea(req.params.id);
    res.json({ success: true, data: categories });
  } catch (err) {
    next(err);
  }
});

router.get("/categories", async (_req, res, next) => {
  try {
    const categories = await getCategories();
    res.json({ success: true, data: categories });
  } catch (err) {
    next(err);
  }
});

router.get("/categories/:id", async (req, res, next) => {
  try {
    const category = await getCategory(req.params.id);
    res.json({ success: true, data: category });
  } catch (err) {
    next(err);
  }
});

router.post("/categories", async (req, res, next) => {
  try {
    const result = await createCategory(req.body || {});
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.patch("/categories/:id", async (req, res, next) => {
  try {
    const result = await updateCategory(req.params.id, req.body || {});
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.delete("/categories/:id", async (req, res, next) => {
  try {
    await deleteCategory(req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/categories/:id/items", async (req, res, next) => {
  try {
    const items = await getItemsByCategory(req.params.id);
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

router.get("/items", async (_req, res, next) => {
  try {
    const items = await getAllItems();
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

router.get("/items/:id", async (req, res, next) => {
  try {
    const item = await getItem(req.params.id);
    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

router.get("/factors", async (_req, res, next) => {
  try {
    const list = await getFactors();
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

router.get("/additional-costs", async (_req, res, next) => {
  try {
    const list = await getAdditionalCosts();
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

router.get("/organizations", async (_req, res, next) => {
  try {
    const list = await getOrganizations();
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

router.patch("/items/:id", async (req, res, next) => {
  try {
    const result = await updateItem(req.params.id, req.body || {});
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/items/:id/media", mediaUpload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: "File is required" });

    let buffer;
    try {
      buffer = file.buffer ?? await fs.readFile(file.path);
    } finally {
      if (file.path) await fs.unlink(file.path).catch(() => {});
    }

    const mediaDoc = await uploadMedia(buffer, file.originalname, file.mimetype);
    const mediaId = mediaDoc?.id;
    if (!mediaId) {
      return res.status(500).json({ success: false, error: "Upload succeeded but media ID was not returned" });
    }

    await attachMediaToItem(req.params.id, mediaId);
    res.json({
      success: true,
      data: {
        mediaId,
        mediaUrl: mediaDoc?.url || "",
        filename: mediaDoc?.filename || file.originalname,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.delete("/items/:id/media/:mediaId", async (req, res, next) => {
  try {
    await detachMediaFromItem(req.params.id, req.params.mediaId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
