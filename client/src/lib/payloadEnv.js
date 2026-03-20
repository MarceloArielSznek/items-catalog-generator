/**
 * Dev-only: optional auto-login when both admin vars are set (same idea as form-builder).
 * Production builds never use VITE_PAYLOAD_ADMIN_* for auto-login.
 */
function getOptionalEnv(key, fallback = "") {
  const value = import.meta.env[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const devAutoLoginEnabled =
  import.meta.env.DEV &&
  Boolean(getOptionalEnv("VITE_PAYLOAD_ADMIN_EMAIL") && getOptionalEnv("VITE_PAYLOAD_ADMIN_PASSWORD"));

export function getDevAutoLoginCredentials() {
  if (!import.meta.env.DEV) return null;
  const email = getOptionalEnv("VITE_PAYLOAD_ADMIN_EMAIL");
  const password = getOptionalEnv("VITE_PAYLOAD_ADMIN_PASSWORD");
  if (!email || !password) return null;
  return { email, password };
}
