import { AsyncLocalStorage } from "node:async_hooks";
import env from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

const storage = new AsyncLocalStorage();

/**
 * Per-request Payload auth: Bearer token from client (production) or optional in dev
 * (falls back to server .env login when absent).
 */
export function getPayloadRequestContext() {
  return storage.getStore() ?? { userToken: null };
}

/** True when the client sent a Bearer token (skip shared server-side caches for Payload data). */
export function isUserBearerToken() {
  return Boolean(getPayloadRequestContext().userToken);
}

export function runWithPayloadContext(context, fn) {
  return storage.run(context, fn);
}

export function payloadRequestContextMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const userToken = match ? match[1].trim() : null;

  if (env.IS_PRODUCTION) {
    if (!userToken) {
      next(new HttpError(401, "Payload authentication required. Sign in with your Payload credentials."));
      return;
    }
    storage.run({ userToken }, () => next());
    return;
  }

  storage.run({ userToken }, () => next());
}
