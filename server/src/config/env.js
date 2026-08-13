import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, "../..");

const env = {
  PORT: parseInt(process.env.PORT, 10) || 3005,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10,
  MAX_MEDIA_SIZE_MB: parseInt(process.env.MAX_MEDIA_SIZE_MB, 10) || 200,
  UPLOAD_DIR: path.resolve(SERVER_ROOT, process.env.UPLOAD_DIR || "src/uploads"),
  GENERATED_DIR: path.resolve(SERVER_ROOT, process.env.GENERATED_DIR || "src/generated"),
  SCENES_DIR: path.resolve(SERVER_ROOT, process.env.SCENES_DIR || "src/scenes"),
  IS_PRODUCTION: process.env.NODE_ENV === "production",

  // Legacy item generator (image compose / scenes / library / payload / enrich).
  // Kept in the repo for dev, but unmounted in prod so only the org generator is
  // exposed. On in dev by default; set ENABLE_ITEM_GENERATOR=true to force-enable.
  ENABLE_ITEM_GENERATOR:
    process.env.ENABLE_ITEM_GENERATOR === "true" ||
    (process.env.ENABLE_ITEM_GENERATOR !== "false" && process.env.NODE_ENV !== "production"),

  // Menaia NestJS API. Base URL only — service code appends `/v1`.
  // The browser is the source of truth (Settings page → `x-menaia-*` headers);
  // these env values are only a fallback for non-browser callers (scripts/cron).
  // See config/menaiaContext.js for per-request resolution.
  MENAIA_API_URL: (process.env.MENAIA_API_URL || process.env.API_BASE_URL || "https://app.menaia.com").replace(/\/+$/, ""),
  // Single service-account API key (mk_live_… / mk_test_…), bound to one org.
  MENAIA_API_KEY: process.env.MENAIA_API_KEY || "",
  MENAIA_TIMEOUT: parseInt(process.env.API_TIMEOUT_MS, 10) || 15000,

  // Optional "Admin user (JWT)" deploy mode: real-user auth via the Supabase
  // password grant, for when a service key can't run the whole deploy.
  // Browser-configured (Settings → `x-supabase-*` headers); these env values
  // are only a non-browser fallback.
  SUPABASE_URL: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",

  // Image search (Serper.dev)
  SERPER_API_KEY: process.env.SERPER_API_KEY || "",

  // Anthropic Claude (vision scoring + enrichment)
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",

  // Image generation providers
  REPLICATE_API_KEY: process.env.REPLICATE_API_KEY || "",   // replicate.com
  GEMINI_API_KEY:    process.env.GEMINI_API_KEY    || "",   // aistudio.google.com

  // Crawl fallback — Jina AI Reader (r.jina.ai). Optional: works without a key
  // (rate-limited); a key raises limits. jina.ai/reader
  JINA_API_KEY:      process.env.JINA_API_KEY      || "",
};

env.MAX_FILE_SIZE_BYTES = env.MAX_FILE_SIZE_MB * 1024 * 1024;
env.MAX_MEDIA_SIZE_BYTES = env.MAX_MEDIA_SIZE_MB * 1024 * 1024;

export default env;
