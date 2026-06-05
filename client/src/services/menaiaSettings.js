// Single source of truth for the Menaia API credentials. Stored in the browser
// (localStorage) and sent to our server as `x-menaia-*` headers on every
// request — nothing lives in the server's .env anymore. See the Settings page.
const STORAGE_KEY = "menaia.credentials";

export function getMenaiaSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return { url: parsed.url || "", key: parsed.key || "" };
  } catch {
    return { url: "", key: "" };
  }
}

export function saveMenaiaSettings({ url, key }) {
  const next = {
    url: (url || "").trim().replace(/\/+$/, ""),
    key: (key || "").trim(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function hasMenaiaSettings() {
  const { url, key } = getMenaiaSettings();
  return Boolean(url && key);
}

// Headers attached to every server request so the backend can resolve the
// active credentials without reading them from .env.
export function menaiaHeaders() {
  const { url, key } = getMenaiaSettings();
  const headers = {};
  if (url) headers["x-menaia-url"] = url;
  if (key) headers["x-menaia-key"] = key;
  return headers;
}
