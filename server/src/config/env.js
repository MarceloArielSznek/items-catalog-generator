import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "../..");

const env = {
  PORT: parseInt(process.env.PORT, 10) || 3001,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10,
  UPLOAD_DIR: path.resolve(SERVER_ROOT, process.env.UPLOAD_DIR || "src/uploads"),
  GENERATED_DIR: path.resolve(SERVER_ROOT, process.env.GENERATED_DIR || "src/generated"),
  SCENES_DIR: path.resolve(SERVER_ROOT, process.env.SCENES_DIR || "src/scenes"),
  IS_PRODUCTION: process.env.NODE_ENV === "production",
};

env.MAX_FILE_SIZE_BYTES = env.MAX_FILE_SIZE_MB * 1024 * 1024;

export default env;
