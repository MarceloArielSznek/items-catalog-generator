import { Router } from "express";
import multer from "multer";
import {
  getWorkAreas,
  getCategoriesByWorkArea,
  getCategories,
  getItemsByCategory,
  getItem,
  updateItem,
  uploadMedia,
  attachMediaToItem,
  detachMediaFromItem,
} from "../services/payloadService.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get("/work-areas", async (_req, res, next) => {
  try {
    const workAreas = await getWorkAreas();
    res.json({ success: true, data: workAreas });
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

router.get("/categories/:id/items", async (req, res, next) => {
  try {
    const items = await getItemsByCategory(req.params.id);
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

router.patch("/items/:id", async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const result = await updateItem(req.params.id, { name, description });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.post("/items/:id/media", upload.single("file"), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: "File is required" });

    const mediaDoc = await uploadMedia(file.buffer, file.originalname, file.mimetype);
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
