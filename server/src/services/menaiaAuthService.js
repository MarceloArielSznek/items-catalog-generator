import env from "../config/env.js";

const COOKIE_CHUNK_SIZE = 3800;
const SESSION_EXPIRY_BUFFER_SECONDS = 60;

let cachedSession = null;

function assertConfig() {
  const missing = [];
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_PUBLISHABLE_KEY) missing.push("SUPABASE_PUBLISHABLE_KEY");
  if (!env.MENAIA_EMAIL) missing.push("MENAIA_EMAIL");
  if (!env.MENAIA_PASSWORD) missing.push("MENAIA_PASSWORD");

  if (missing.length > 0) {
    throw new Error(`Missing Menaia Supabase env vars: ${missing.join(", ")}`);
  }
}

function getSupabaseProjectRef(supabaseUrl) {
  const hostname = new URL(supabaseUrl).hostname;
  return hostname.split(".")[0];
}

function buildCookieHeader(cookieName, encodedPayload) {
  const chunks = [];
  for (let index = 0; index < encodedPayload.length; index += COOKIE_CHUNK_SIZE) {
    chunks.push(`${cookieName}.${chunks.length}=${encodedPayload.slice(index, index + COOKIE_CHUNK_SIZE)}`);
  }
  return chunks.join("; ");
}

function appendCookie(baseCookie, nextCookie) {
  return [baseCookie, nextCookie].filter(Boolean).join("; ");
}

function buildSupabaseCookie(session) {
  const projectRef = getSupabaseProjectRef(env.SUPABASE_URL);
  const cookieName = `sb-${projectRef}-auth-token`;
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type ?? "bearer",
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    user: session.user,
  };

  return buildCookieHeader(cookieName, encodeURIComponent(JSON.stringify(payload)));
}

function getSessionExpiry(session) {
  if (Number.isFinite(session.expires_at)) return session.expires_at;
  if (Number.isFinite(session.expires_in)) return Math.floor(Date.now() / 1000) + session.expires_in;
  return Math.floor(Date.now() / 1000) + 3600;
}

function isCachedSessionValid() {
  if (!cachedSession) return false;
  return Date.now() / 1000 < cachedSession.expiresAt - SESSION_EXPIRY_BUFFER_SECONDS;
}

async function signInToSupabase() {
  assertConfig();

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({
      email: env.MENAIA_EMAIL,
      password: env.MENAIA_PASSWORD,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error_description ?? data?.msg ?? data?.message ?? response.statusText;
    throw new Error(`Supabase sign-in failed: ${message}`);
  }

  if (!data?.access_token || !data?.refresh_token) {
    throw new Error("Supabase sign-in failed: response did not include a complete session.");
  }

  cachedSession = {
    cookie: buildSupabaseCookie(data),
    expiresAt: getSessionExpiry(data),
  };

  return cachedSession;
}

export function clearMenaiaSessionCache() {
  cachedSession = null;
}

export async function getMenaiaCookieHeader({ forceRefresh = false } = {}) {
  if (!forceRefresh && isCachedSessionValid()) {
    return appendCookie(env.VERCEL_TOKEN ? `_vercel_jwt=${env.VERCEL_TOKEN}` : "", cachedSession.cookie);
  }

  const session = await signInToSupabase();
  return appendCookie(env.VERCEL_TOKEN ? `_vercel_jwt=${env.VERCEL_TOKEN}` : "", session.cookie);
}

export async function probeMenaiaAuth() {
  const cookie = await getMenaiaCookieHeader({ forceRefresh: true });
  return {
    ok: true,
    expiresAt: cachedSession?.expiresAt ?? null,
    cookieChunks: cookie.split("; ").filter((part) => part.includes("-auth-token.")).length,
  };
}
