import path from "path";
import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } from "../../../shared/constants/imageRules.js";
import env from "../config/env.js";

export function isAllowedMimeType(mimetype) {
  return ALLOWED_MIME_TYPES.includes(mimetype);
}

export function isAllowedExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

export function isWithinSizeLimit(sizeBytes) {
  return sizeBytes <= env.MAX_FILE_SIZE_BYTES;
}

export function validateFile(file) {
  const errors = [];

  if (!isAllowedMimeType(file.mimetype)) {
    errors.push(`Invalid file type "${file.mimetype}". Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`);
  }

  if (!isAllowedExtension(file.originalname)) {
    errors.push(`Invalid file extension for "${file.originalname}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`);
  }

  if (!isWithinSizeLimit(file.size)) {
    errors.push(`File "${file.originalname}" exceeds ${env.MAX_FILE_SIZE_MB}MB limit`);
  }

  return errors;
}
