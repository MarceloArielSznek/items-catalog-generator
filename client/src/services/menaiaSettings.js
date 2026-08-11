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
      // Demo-data population (post-deploy): real-user Supabase auth + Payload
      // REST host. Only the "Populate demo data" step needs these.
      supabaseUrl: parsed.supabaseUrl || "",
      supabaseAnonKey: parsed.supabaseAnonKey || "",
      payloadUrl: parsed.payloadUrl || "",
    };
  } catch {
    return { url: "", key: "", supabaseUrl: "", supabaseAnonKey: "", payloadUrl: "" };
  }
}

export function saveMenaiaSettings({ url, key, supabaseUrl, supabaseAnonKey, payloadUrl }) {
  const next = {
    url: (url || "").trim().replace(/\/+$/, ""),
    key: (key || "").trim(),
    supabaseUrl: (supabaseUrl || "").trim().replace(/\/+$/, ""),
    supabaseAnonKey: (supabaseAnonKey || "").trim(),
    payloadUrl: (payloadUrl || "").trim().replace(/\/+$/, ""),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function hasMenaiaSettings() {
  const { url, key } = getMenaiaSettings();
  return Boolean(url && key);
}

// True when the extra config the demo-data step needs is present.
export function hasDemoDataSettings() {
  const { supabaseUrl, supabaseAnonKey, payloadUrl } = getMenaiaSettings();
  return Boolean(supabaseUrl && supabaseAnonKey && payloadUrl);
}

// Headers attached to every server request so the backend can resolve the
// active credentials without reading them from .env.
export function menaiaHeaders() {
  const { url, key, supabaseUrl, supabaseAnonKey, payloadUrl } = getMenaiaSettings();
  const headers = {};
  if (url) headers["x-menaia-url"] = url;
  if (key) headers["x-menaia-key"] = key;
  if (supabaseUrl) headers["x-supabase-url"] = supabaseUrl;
  if (supabaseAnonKey) headers["x-supabase-anon-key"] = supabaseAnonKey;
  if (payloadUrl) headers["x-payload-url"] = payloadUrl;
  return headers;
}
