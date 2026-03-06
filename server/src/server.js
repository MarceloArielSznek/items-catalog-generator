import app from "./app.js";
import env from "./config/env.js";
import { ensureDir } from "./utils/ensureDir.js";
import logger from "./utils/logger.js";

async function start() {
  await ensureDir(env.UPLOAD_DIR);
  await ensureDir(env.GENERATED_DIR);
  await ensureDir(env.SCENES_DIR);

  app.listen(env.PORT, () => {
    logger.info(`Server running on http://localhost:${env.PORT}`);
    logger.info(`Upload dir: ${env.UPLOAD_DIR}`);
    logger.info(`Generated dir: ${env.GENERATED_DIR}`);
  });
}

start().catch((err) => {
  logger.error("Failed to start server", { error: err.message });
  process.exit(1);
});
