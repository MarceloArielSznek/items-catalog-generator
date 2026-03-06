import { Router } from "express";
import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import env from "../config/env.js";
import { isAllowedMimeType } from "../utils/fileValidation.js";
import { createScene, listScenes, getScene, deleteScene } from "../services/sceneService.js";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    cb(null, isAllowedMimeType(file.mimetype));
  },
  limits: { fileSize: env.MAX_FILE_SIZE_BYTES },
});

const sceneUpload = upload.fields([
  { name: "background", maxCount: 1 },
  { name: "logo", maxCount: 1 },
]);

const router = Router();

router.post("/", sceneUpload, async (req, res, next) => {
  try {
    const bgFile = req.files?.background?.[0];
    const logoFile = req.files?.logo?.[0];

    if (!bgFile || !logoFile) {
      return res.status(400).json({ success: false, error: "Background and logo files are required" });
    }

    const scene = await createScene({
      name: req.body.name,
      backgroundFile: bgFile,
      logoFile: logoFile,
      logoPosition: req.body.logoPosition,
    });

    res.status(201).json({ success: true, data: scene });
  } catch (err) {
    next(err);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    const scenes = await listScenes();
    res.json({ success: true, data: scenes });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const scene = await getScene(req.params.id);
    if (!scene) return res.status(404).json({ success: false, error: "Scene not found" });
    res.json({ success: true, data: scene });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const ok = await deleteScene(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: "Scene not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
