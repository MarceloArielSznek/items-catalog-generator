import fs from "fs/promises";
import path from "path";
import env from "../config/env.js";
import logger from "../utils/logger.js";

export function getUploadedFilePath(file) {
  return path.resolve(env.UPLOAD_DIR, file.filename);
}

export function getGeneratedFilePath(filename) {
  return path.resolve(env.GENERATED_DIR, filename);
}

export async function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
      logger.debug(`Cleaned up file: ${filePath}`);
    } catch (err) {
      logger.warn(`Failed to clean up file: ${filePath}`, { error: err.message });
    }
  }
}

export function buildPublicUrl(filename) {
  return `/generated/${filename}`;
}
