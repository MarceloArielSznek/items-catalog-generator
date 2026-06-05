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
  MAX_MEDIA_SIZE_MB: parseInt(process.env.MAX_MEDIA_SIZE_MB, 10) || 200,
  UPLOAD_DIR: path.resolve(SERVER_ROOT, process.env.UPLOAD_DIR || "src/uploads"),
  GENERATED_DIR: path.resolve(SERVER_ROOT, process.env.GENERATED_DIR || "src/generated"),
  SCENES_DIR: path.resolve(SERVER_ROOT, process.env.SCENES_DIR || "src/scenes"),
  IS_PRODUCTION: process.env.NODE_ENV === "production",

  // Menaia NestJS API. Base URL only — service code appends `/v1`.
  MENAIA_API_URL: (process.env.MENAIA_API_URL || process.env.API_BASE_URL || "https://app.menaia.com").replace(/\/+$/, ""),
  // Single service-account API key (mk_live_… / mk_test_…), bound to one org.
  MENAIA_API_KEY: process.env.MENAIA_API_KEY || "",
  MENAIA_TIMEOUT: parseInt(process.env.API_TIMEOUT_MS, 10) || 15000,

  // Image search (Serper.dev)
  SERPER_API_KEY: process.env.SERPER_API_KEY || "",

  // Anthropic Claude (vision scoring + enrichment)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
};

env.MAX_FILE_SIZE_BYTES = env.MAX_FILE_SIZE_MB * 1024 * 1024;
env.MAX_MEDIA_SIZE_BYTES = env.MAX_MEDIA_SIZE_MB * 1024 * 1024;

export function validateConfig() {
  const missing = [];
  if (!env.MENAIA_API_URL) missing.push("MENAIA_API_URL or API_BASE_URL");
  if (!env.MENAIA_API_KEY) missing.push("MENAIA_API_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing Menaia API env vars: ${missing.join(", ")}`);
  }
}

export default env;
