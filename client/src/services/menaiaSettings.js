// Single source of truth for the Menaia API credentials. Stored in the browser
// (localStorage) and sent to our server as `x-menaia-*` headers on every
// request — nothing lives in the server's .env anymore. See the Settings page.
const STORAGE_KEY = "menaia.credentials";

export function getMenaiaSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      url: parsed.url || "",
      key: parsed.key || "",
      // Admin-user deploy mode: Supabase password grant for a real org admin.
      // Only the "Admin user (JWT)" deploy path needs these.
      supabaseUrl: parsed.supabaseUrl || "",
      supabaseAnonKey: parsed.supabaseAnonKey || "",
    };
  } catch {
    return { url: "", key: "", supabaseUrl: "", supabaseAnonKey: "" };
  }
}

export function saveMenaiaSettings({ url, key, supabaseUrl, supabaseAnonKey }) {
  const next = {
    url: (url || "").trim().replace(/\/+$/, ""),
    key: (key || "").trim(),
    supabaseUrl: (supabaseUrl || "").trim().replace(/\/+$/, ""),
    supabaseAnonKey: (supabaseAnonKey || "").trim(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function hasMenaiaSettings() {
  const { url, key } = getMenaiaSettings();
  return Boolean(url && key);
}

// True when the extra config the admin-user deploy mode needs is present.
export function hasAdminAuthSettings() {
  const { supabaseUrl, supabaseAnonKey } = getMenaiaSettings();
  return Boolean(supabaseUrl && supabaseAnonKey);
}

// Headers attached to every server request so the backend can resolve the
// active credentials without reading them from .env.
export function menaiaHeaders() {
  const { url, key, supabaseUrl, supabaseAnonKey } = getMenaiaSettings();
  const headers = {};
  if (url) headers["x-menaia-url"] = url;
  if (key) headers["x-menaia-key"] = key;
  if (supabaseUrl) headers["x-supabase-url"] = supabaseUrl;
  if (supabaseAnonKey) headers["x-supabase-anon-key"] = supabaseAnonKey;
  return headers;
}
