import env from "../config/env.js";

const V1_PREFIX = "/v1";

function buildApiUrl(pathname) {
  return `${env.MENAIA_API_URL}${V1_PREFIX}${pathname}`;
}

/**
 * Static service-account API key. The key is bound to a single org, so there
 * is no session to refresh — every request carries the same bearer.
 */
export function getMenaiaApiKey() {
  if (!env.MENAIA_API_KEY) {
    throw new Error("Missing Menaia API key: set MENAIA_API_KEY");
  }
  return env.MENAIA_API_KEY;
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
