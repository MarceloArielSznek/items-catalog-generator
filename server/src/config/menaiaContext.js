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
  storage.run({ key, url }, () => next());
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
