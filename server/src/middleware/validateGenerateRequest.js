import { REQUIRED_FIELDS } from "../../../shared/constants/imageRules.js";
import { validateFile } from "../utils/fileValidation.js";
import logger from "../utils/logger.js";

export function validateGenerateRequest(req, res, next) {
  const missingFields = [];

  for (const field of REQUIRED_FIELDS) {
    if (!req.files?.[field]?.length) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Missing required files: ${missingFields.join(", ")}`,
    });
  }

  const allErrors = [];

  for (const field of REQUIRED_FIELDS) {
    const file = req.files[field][0];
    const errors = validateFile(file);
    if (errors.length > 0) {
      allErrors.push({ field, errors });
    }
  }

  if (allErrors.length > 0) {
    const summary = allErrors.map((e) => `${e.field}: ${e.errors.join("; ")}`).join(" | ");
    logger.warn("File validation failed", { details: allErrors });
    return res.status(400).json({
      success: false,
      error: summary,
      details: allErrors,
    });
  }

  next();
}
