import logger from "../utils/logger.js";

export function errorHandler(err, _req, res, _next) {
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
