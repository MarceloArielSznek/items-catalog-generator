import logger from "../utils/logger.js";
import { HttpError } from "../utils/httpError.js";

export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    if (err.status >= 500) {
      logger.error("HTTP error", { status: err.status, message: err.message, stack: err.stack });
    } else {
      logger.warn("HTTP client error", { status: err.status, message: err.message });
    }
    return res.status(err.status).json({
      success: false,
      error: err.message,
    });
  }

  logger.error("Unhandled error", { message: err.message, stack: err.stack });

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      error: "File size exceeds the allowed limit",
    });
  }

  if (err.message?.startsWith("Invalid file type")) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: err.message || "Internal server error",
  });
}
