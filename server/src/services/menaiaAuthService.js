import {
  getMenaiaApiKey as resolveApiKey,
  getMenaiaApiUrl,
} from "../config/menaiaContext.js";

const V1_PREFIX = "/v1";

function buildApiUrl(pathname) {
  return `${getMenaiaApiUrl()}${V1_PREFIX}${pathname}`;
}

/**
 * Service-account API key for the active request. Resolved from the browser
 * (sent per-request) with a `.env` fallback for non-browser callers. The key is
 * bound to a single org, so there is no session to refresh — every request
 * carries the same bearer.
 */
export function getMenaiaApiKey() {
  const key = resolveApiKey();
  if (!key) {
    throw new Error("Missing Menaia API key: set it in the app's Settings page");
  }
  return key;
}

/**
 * Back-compat shim for callers that used to fetch a Supabase session cookie.
 * Now returns the static bearer value (no `Bearer ` prefix, no cookie).
 */
export async function getMenaiaCookieHeader() {
  return getMenaiaApiKey();
}

/** No session cache to clear with a static key — kept for signature stability. */
export function clearMenaiaSessionCache() {
  // no-op: the API key is static.
}

/**
 * Probe the API key against `GET /v1/me`. Surfaces the bound organization and
 * the principal's scopes (drives `/api/payload/session`).
 */
export async function probeMenaiaAuth() {
  const res = await fetch(buildApiUrl("/me"), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getMenaiaApiKey()}`,
      "Content-Type": "application/json",
    },
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const message = body?.message || body?.statusCode || res.statusText;
    throw new Error(`Menaia auth probe failed (${res.status}): ${message}`);
  }

  return {
    ok: true,
    organization: body?.organization ?? null,
    scopes: body?.principal?.scopes ?? [],
  };
}
