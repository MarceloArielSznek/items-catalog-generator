import { Router } from "express";
import path from "path";
import fsp from "fs/promises";
import archiver from "archiver";
import env from "../config/env.js";
import logger from "../utils/logger.js";

const router = Router();

router.post("/download-zip", async (req, res, next) => {
  try {
    const { filenames } = req.body;

    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ success: false, error: "filenames array is required" });
    }

    const validFiles = [];
    for (const name of filenames) {
      if (typeof name !== "string" || name.includes("..") || name.includes("/") || name.includes("\\")) continue;
      const fullPath = path.resolve(env.GENERATED_DIR, name);
      try {
        await fsp.access(fullPath);
        validFiles.push({ name, fullPath });
      } catch {
        logger.warn("ZIP: file not found, skipping", { name });
      }
    }

    if (validFiles.length === 0) {
      return res.status(404).json({ success: false, error: "No valid files found" });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="catalog-images.zip"');

    const archive = archiver("zip", { zlib: { level: 5 } });
    archive.on("error", (err) => next(err));
    archive.pipe(res);

    for (const { name, fullPath } of validFiles) {
      archive.file(fullPath, { name });
    }

    await archive.finalize();
    logger.info("ZIP download complete", { fileCount: validFiles.length });
  } catch (err) {
    next(err);
  }
});

export default router;
