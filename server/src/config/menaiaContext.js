import { AsyncLocalStorage } from "node:async_hooks";
import env from "./env.js";

// Per-request Menaia credentials. The browser is the single source of truth
// (see the Settings page) and sends them on every request as `x-menaia-*`
// headers; this stashes them so any downstream service can resolve the active
// key/URL without threading `req` through. Falls back to `.env` for non-browser
// callers (scripts, cron) when no header is present.
const storage = new AsyncLocalStorage();

export function menaiaContextMiddleware(req, _res, next) {
  const key = req.get("x-menaia-key") || "";
  const url = (req.get("x-menaia-url") || "").replace(/\/+$/, "");
  // Demo-data population config (optional; only the post-deploy step needs it).
  const supabaseUrl = (req.get("x-supabase-url") || "").replace(/\/+$/, "");
  const supabaseAnonKey = req.get("x-supabase-anon-key") || "";
  const payloadUrl = (req.get("x-payload-url") || "").replace(/\/+$/, "");
  storage.run({ key, url, supabaseUrl, supabaseAnonKey, payloadUrl }, () => next());
}

export function getMenaiaApiKey() {
  const store = storage.getStore();
  return (store && store.key) || env.MENAIA_API_KEY || "";
}

export function getMenaiaApiUrl() {
  const store = storage.getStore();
  const url = (store && store.url) || env.MENAIA_API_URL || "";
  return url.replace(/\/+$/, "");
}

// ── Demo-data population config (Supabase auth + Payload REST host) ───────────
export function getSupabaseUrl() {
  const store = storage.getStore();
  return ((store && store.supabaseUrl) || env.SUPABASE_URL || "").replace(/\/+$/, "");
}

export function getSupabaseAnonKey() {
  const store = storage.getStore();
  return (store && store.supabaseAnonKey) || env.SUPABASE_ANON_KEY || "";
}

// Payload/Next web host that serves `/api/<collection>`. Falls back to the
// Menaia API URL (same host in prod) when no dedicated Payload URL is set.
export function getPayloadUrl() {
  const store = storage.getStore();
  const url = (store && store.payloadUrl) || env.PAYLOAD_URL || getMenaiaApiUrl();
  return url.replace(/\/+$/, "");
}

export function validateDemoDataConfig() {
  const missing = [];
  if (!getSupabaseUrl()) missing.push("Supabase URL");
  if (!getSupabaseAnonKey()) missing.push("Supabase anon key");
  if (!getPayloadUrl()) missing.push("Payload URL");
  if (missing.length > 0) {
    throw new Error(
      `Missing demo-data config: ${missing.join(", ")}. Set them in the app's Settings page.`,
    );
  }
}

export function validateMenaiaConfig() {
  const missing = [];
  if (!getMenaiaApiUrl()) missing.push("Menaia API URL");
  if (!getMenaiaApiKey()) missing.push("Menaia API key");
  if (missing.length > 0) {
    throw new Error(
      `Missing Menaia credentials: ${missing.join(", ")}. Set them in the app's Settings page.`,
    );
  }
}
