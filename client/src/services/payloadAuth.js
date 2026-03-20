import { getDevAutoLoginCredentials } from "../lib/payloadEnv.js";

const TOKEN_KEY = "payload_catalog_token";
const EXP_KEY = "payload_catalog_exp";
const USER_KEY = "payload_catalog_user";

const LOGIN_PATH = "/api/payload/auth/login";

export async function login(email, password) {
  try {
    const res = await fetch(LOGIN_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || data.message || `Login failed (${res.status})`,
      };
    }
    const token = data.token;
    const exp = data.exp ?? Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const user = data.user;
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
      sessionStorage.setItem(EXP_KEY, String(exp));
      if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    }
    return { ok: true, token, exp, user };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Network error";
    return { ok: false, error: message };
  }
}

export function getStoredToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredExp() {
  const exp = sessionStorage.getItem(EXP_KEY);
  return exp ? parseInt(exp, 10) : null;
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXP_KEY);
  sessionStorage.removeItem(USER_KEY);
}

export function isAuthenticated() {
  const token = getStoredToken();
  const exp = getStoredExp();
  if (!token || exp == null) return false;
  return Date.now() / 1000 < exp - 60;
}

/**
 * Dev only: if not authenticated and .env has admin email+password, log in once.
 */
export async function ensureDevToken() {
  if (!import.meta.env.DEV) return null;
  if (isAuthenticated()) return null;
  const creds = getDevAutoLoginCredentials();
  if (!creds) return null;
  return login(creds.email, creds.password);
}

export function getAuthHeader() {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
