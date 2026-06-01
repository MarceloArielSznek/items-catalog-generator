import env from "../config/env.js";
import logger from "../utils/logger.js";
import { clearMenaiaSessionCache, getMenaiaCookieHeader, probeMenaiaAuth } from "./menaiaAuthService.js";

const API_PREFIX = "/api";
const WORK_AREAS_COLLECTION = "work-areas";
const CATEGORIES_COLLECTION = "item-categories";
const ITEMS_COLLECTION = "items";
const MEDIA_COLLECTION = "media";
const FACTORS_COLLECTION = "factors";
const ADDITIONAL_COSTS_COLLECTION = "additional-costs";
const ORGANIZATIONS_COLLECTION = "organizations";
const ITEM_MEDIA_FIELD = "media";
const ITEM_NAME_FIELD = "name";
const ITEM_DESCRIPTION_FIELD = "itemInfo";
const ITEM_CATEGORY_FIELD = "category";
const ITEM_UNIT_FIELD = "unit";
const ITEM_MATERIAL_COST_FIELD = "materialCost";
const PAGE_LIMIT = 100;
const QUERY_DEPTH = 1;
const CACHE_TTL_MS = 2 * 60 * 1000; // 5 min for categories/items

const workAreasCache = new Map(); // orgId (or "__all__") -> { data, expires }
const categoriesByWorkAreaCache = new Map(); // workAreaId -> { data, expires }
const categoriesCache = new Map(); // orgId (or "__all__") -> { data, expires }
const itemsByCategoryCache = new Map(); // categoryId -> { data, expires }

export { probeMenaiaAuth };

function getCachedCategories(orgId) {
  const key = orgId ?? "__all__";
  const entry = categoriesCache.get(key);
  if (entry && Date.now() < entry.expires) return entry.data;
  return null;
}

function setCachedCategories(orgId, data) {
  const key = orgId ?? "__all__";
  categoriesCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

function getCachedItems(categoryId) {
  const entry = itemsByCategoryCache.get(String(categoryId));
  if (entry && Date.now() < entry.expires) return entry.data;
  return null;
}

function setCachedItems(categoryId, data) {
  itemsByCategoryCache.set(String(categoryId), {
    data,
    expires: Date.now() + CACHE_TTL_MS,
  });
}

export function invalidateItemsCacheForCategory(categoryId) {
  if (categoryId != null) itemsByCategoryCache.delete(String(categoryId));
}

export function invalidateWorkAreasCache() {
  workAreasCache.clear();
  categoriesByWorkAreaCache.clear();
}

export function invalidateCategoriesCache() {
  categoriesCache.clear();
  categoriesByWorkAreaCache.clear();
}

function buildUrl(...segments) {
  const parts = [env.PAYLOAD_API_URL, API_PREFIX, ...segments]
    .filter(Boolean)
    .map((s) => String(s).replace(/^\/+|\/+$/g, ""));
  return parts.join("/");
}

function validateConfig() {
  const missing = [];
  if (!env.PAYLOAD_API_URL) missing.push("MENAIA_API_URL or API_BASE_URL");
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!env.SUPABASE_PUBLISHABLE_KEY) missing.push("SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!env.MENAIA_EMAIL) missing.push("MENAIA_EMAIL or API_USER");
  if (!env.MENAIA_PASSWORD) missing.push("MENAIA_PASSWORD or API_PASSWORD");
  if (missing.length > 0) {
    throw new Error(`Missing Menaia auth env vars: ${missing.join(", ")}`);
  }
}

function parseJsonBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function payloadFetch(url, options = {}) {
  const { retryAuth = true, timeout: requestTimeout, ...fetchOptions } = options;
  const timeout = requestTimeout || env.PAYLOAD_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const headers = { ...(fetchOptions.headers || {}) };

  try {
    const res = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
    const body = parseJsonBody(await res.text());
    if (!res.ok) {
      if (retryAuth && (res.status === 401 || res.status === 403) && headers.Cookie?.includes("-auth-token")) {
        clearMenaiaSessionCache();
        const nextHeaders = { ...headers, Cookie: await getMenaiaCookieHeader({ forceRefresh: true }) };
        return payloadFetch(url, { ...fetchOptions, headers: nextHeaders, retryAuth: false });
      }
      const msg = body?.errors?.[0]?.message || body?.message || body || `Payload API ${res.status}`;
      throw new Error(msg);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function getToken() {
  validateConfig();
  return getMenaiaCookieHeader();
}

function authHeaders(cookie) {
  return {
    Cookie: cookie,
    "Content-Type": "application/json",
  };
}

async function fetchAllPages(collection, params = {}) {
  const token = await getToken();
  const docs = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const qs = new URLSearchParams({
      limit: String(PAGE_LIMIT),
      page: String(page),
      depth: String(QUERY_DEPTH),
      ...params,
    });
    const url = `${buildUrl(collection)}?${qs}`;
    const data = await payloadFetch(url, { headers: authHeaders(token) });

    docs.push(...(data?.docs || []));
    hasNextPage = Boolean(data?.hasNextPage);
    page += 1;
  }

  return docs;
}

export async function getWorkAreas(orgId) {
  const key = orgId ?? "__all__";
  const entry = workAreasCache.get(key);
  if (entry && Date.now() < entry.expires) {
    logger.info(`Work areas from cache (${entry.data.length} items, org=${key})`);
    return entry.data;
  }
  const params = { depth: "0" };
  if (orgId) params["where[organization][equals]"] = String(orgId);
  const docs = await fetchAllPages(WORK_AREAS_COLLECTION, params);
  const workAreas = docs.map((doc) => ({ ...doc, id: doc.id, name: doc.name }));
  logger.info(`Fetched ${workAreas.length} work areas from Payload (org=${key})`);
  workAreasCache.set(key, { data: workAreas, expires: Date.now() + CACHE_TTL_MS });
  return workAreas;
}

export async function getWorkArea(id) {
  if (!id) throw new Error("Work area ID is required.");
  const token = await getToken();
  const url = `${buildUrl(WORK_AREAS_COLLECTION, id)}?depth=1`;
  return payloadFetch(url, { headers: authHeaders(token) });
}

export async function createWorkArea(body) {
  const token = await getToken();
  const url = buildUrl(WORK_AREAS_COLLECTION);
  const result = await payloadFetch(url, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  invalidateWorkAreasCache();
  logger.info("Created work area in Payload", { id: result?.id });
  return result;
}

export async function updateWorkArea(id, body) {
  if (!id) throw new Error("Work area ID is required.");
  const token = await getToken();
  const url = buildUrl(WORK_AREAS_COLLECTION, id);
  const result = await payloadFetch(url, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  invalidateWorkAreasCache();
  logger.info("Updated work area in Payload", { id });
  return result;
}

export async function deleteWorkArea(id) {
  if (!id) throw new Error("Work area ID is required.");
  const token = await getToken();
  const url = buildUrl(WORK_AREAS_COLLECTION, id);
  await payloadFetch(url, { method: "DELETE", headers: authHeaders(token) });
  invalidateWorkAreasCache();
  logger.info("Deleted work area from Payload", { id });
}

export async function getCategoriesByWorkArea(workAreaId) {
  if (!workAreaId) throw new Error("Work area ID is required.");
  const entry = categoriesByWorkAreaCache.get(String(workAreaId));
  if (entry && Date.now() < entry.expires) {
    logger.info(`Categories for work area ${workAreaId} from cache (${entry.data.length} items)`);
    return entry.data;
  }
  const token = await getToken();
  const url = `${buildUrl(WORK_AREAS_COLLECTION, workAreaId)}?depth=1`;
  const workArea = await payloadFetch(url, { headers: authHeaders(token) });

  const raw = Array.isArray(workArea?.item_categories) ? workArea.item_categories : [];
  const categories = raw
    .map((entry) => (typeof entry === "object" && entry !== null ? { id: entry.id, name: entry.name } : null))
    .filter(Boolean);

  logger.info(`Fetched ${categories.length} categories for work area ${workAreaId}`);
  categoriesByWorkAreaCache.set(String(workAreaId), {
    data: categories,
    expires: Date.now() + CACHE_TTL_MS,
  });
  return categories;
}

export async function getCategories(orgId) {
  const cached = getCachedCategories(orgId);
  if (cached) {
    logger.info(`Categories from cache (${cached.length} items, org=${orgId ?? "__all__"})`);
    return cached;
  }
  const params = {};
  if (orgId) params["where[organization][equals]"] = String(orgId);
  const categories = await fetchAllPages(CATEGORIES_COLLECTION, params);
  logger.info(`Fetched ${categories.length} categories from Payload (org=${orgId ?? "__all__"})`);
  setCachedCategories(orgId, categories);
  return categories;
}

export async function getCategory(id) {
  if (!id) throw new Error("Category ID is required.");
  const token = await getToken();
  const url = `${buildUrl(CATEGORIES_COLLECTION, id)}?depth=1`;
  return payloadFetch(url, { headers: authHeaders(token) });
}

export async function createCategory(body) {
  const token = await getToken();
  const url = buildUrl(CATEGORIES_COLLECTION);
  const result = await payloadFetch(url, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  invalidateCategoriesCache();
  invalidateWorkAreasCache();
  logger.info("Created item category in Payload", { id: result?.id });
  return result;
}

export async function updateCategory(id, body) {
  if (!id) throw new Error("Category ID is required.");
  const token = await getToken();
  const url = buildUrl(CATEGORIES_COLLECTION, id);
  const result = await payloadFetch(url, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  invalidateCategoriesCache();
  invalidateWorkAreasCache();
  logger.info("Updated item category in Payload", { id });
  return result;
}

export async function deleteCategory(id) {
  if (!id) throw new Error("Category ID is required.");
  const token = await getToken();
  const url = buildUrl(CATEGORIES_COLLECTION, id);
  await payloadFetch(url, { method: "DELETE", headers: authHeaders(token) });
  invalidateCategoriesCache();
  invalidateWorkAreasCache();
  logger.info("Deleted item category from Payload", { id });
}

export async function getItemsByCategory(categoryId) {
  const cached = getCachedItems(categoryId);
  if (cached) {
    logger.info(`Items for category ${categoryId} from cache (${cached.length} items)`);
    return cached;
  }
  const token = await getToken();
  const url = `${buildUrl(CATEGORIES_COLLECTION, categoryId)}?depth=2`;
  const category = await payloadFetch(url, { headers: authHeaders(token) });

  const rawItems = Array.isArray(category?.items) ? category.items : [];
  const items = rawItems
    .map((entry) => (typeof entry === "object" && entry !== null ? entry : null))
    .filter(Boolean);

  logger.info(`Fetched ${items.length} items for category ${categoryId}`);
  setCachedItems(categoryId, items);
  return items;
}

export async function getAllItems() {
  const docs = await fetchAllPages(ITEMS_COLLECTION, { depth: "0" });
  return docs.map((doc) => ({
    id: doc.id,
    name: doc.name ?? String(doc.id),
  }));
}

export async function getItem(itemId) {
  if (!itemId) throw new Error("Item ID is required.");
  const token = await getToken();
  const url = `${buildUrl(ITEMS_COLLECTION, itemId)}?depth=${QUERY_DEPTH}`;
  return payloadFetch(url, { headers: authHeaders(token) });
}

export async function getFactors() {
  try {
    const docs = await fetchAllPages(FACTORS_COLLECTION, { depth: "0" });
    return docs.map((doc) => ({
      id: doc.id,
      label: doc.name ?? doc.title ?? String(doc.id),
    }));
  } catch (err) {
    logger.warn("Failed to fetch factors from Payload (collection may not exist):", err.message);
    return [];
  }
}

export async function getAdditionalCosts() {
  try {
    const docs = await fetchAllPages(ADDITIONAL_COSTS_COLLECTION, { depth: "0" });
    return docs.map((doc) => ({
      id: doc.id,
      label: doc.title ?? doc.name ?? String(doc.id),
    }));
  } catch (err) {
    logger.warn("Failed to fetch additional costs from Payload (collection may not exist):", err.message);
    return [];
  }
}

export async function getOrganizations() {
  try {
    const docs = await fetchAllPages(ORGANIZATIONS_COLLECTION, { depth: "0" });
    return docs.map((doc) => ({
      id: doc.id,
      name: doc.name ?? doc.title ?? String(doc.id),
    }));
  } catch (err) {
    logger.warn("Failed to fetch organizations from Payload (collection may not exist):", err.message);
    return [];
  }
}

export async function updateItem(itemId, body) {
  if (!itemId) throw new Error("Item ID is required.");
  const token = await getToken();
  const url = buildUrl(ITEMS_COLLECTION, itemId);

  const payload = {};
  if (body.name != null) payload[ITEM_NAME_FIELD] = String(body.name).trim();
  if (body.description != null) payload[ITEM_DESCRIPTION_FIELD] = String(body.description).trim();
  if (body.unit != null) payload[ITEM_UNIT_FIELD] = String(body.unit).trim();
  if (body.materialCost != null) {
    const num = Number(body.materialCost);
    payload[ITEM_MATERIAL_COST_FIELD] = Number.isNaN(num) ? 0 : num;
  }

  if (body.laborHours != null) {
    const n = Number(body.laborHours);
    payload.laborHours = Number.isNaN(n) ? 0 : n;
  }
  if (body.multiplierOverride != null && body.multiplierOverride !== "") {
    const n = Number(body.multiplierOverride);
    payload.multiplierOverride = Number.isNaN(n) ? undefined : n;
  }
  if (typeof body.subItem === "boolean") payload.subItem = body.subItem;
  if (typeof body.requiresInfo === "boolean") payload.requiresInfo = body.requiresInfo;
  if (body.factors !== undefined) payload.factors = body.factors;
  if (Array.isArray(body.additional_costs)) payload.additional_costs = body.additional_costs;

  const reserved = new Set(["description", "laborHours", "multiplierOverride", "subItem", "requiresInfo", "factors", "additional_costs"]);
  for (const [key, value] of Object.entries(body)) {
    if (reserved.has(key) || payload[key] !== undefined) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      payload[key] = value;
    } else if (Array.isArray(value)) {
      payload[key] = value;
    }
  }

  const result = await payloadFetch(url, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  const categoryId = result?.[ITEM_CATEGORY_FIELD]?.id ?? result?.[ITEM_CATEGORY_FIELD];
  if (categoryId != null) invalidateItemsCacheForCategory(categoryId);
  logger.info(`Updated item ${itemId} in Payload`);
  return result;
}

export async function uploadMedia(fileBuffer, filename, mimeType) {
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    throw new Error("File buffer is required.");
  }

  const url = buildUrl(MEDIA_COLLECTION);

  const sendUpload = async (cookie) => {
    const blob = new Blob([fileBuffer], { type: mimeType || "application/octet-stream" });
    const form = new globalThis.FormData();
    form.append("file", blob, filename || "upload.bin");

    return fetch(url, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
  };

  let res = await sendUpload(await getToken());
  if (res.status === 401 || res.status === 403) {
    clearMenaiaSessionCache();
    res = await sendUpload(await getMenaiaCookieHeader({ forceRefresh: true }));
  }

  const body = parseJsonBody(await res.text());
  if (!res.ok) {
    throw new Error(body?.errors?.[0]?.message || body?.message || body || `Media upload failed (${res.status})`);
  }

  const doc = body?.doc || body;
  logger.info(`Uploaded media to Payload: ${doc?.id}`);
  return doc;
}

function relationToIdArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(relationToIdArray);
  if (typeof value === "object" && "id" in value) return [value.id];
  return [value];
}

export async function attachMediaToItem(itemId, mediaId) {
  if (!itemId) throw new Error("Item ID is required.");
  if (!mediaId) throw new Error("Media ID is required.");

  const item = await getItem(itemId);
  const existingIds = relationToIdArray(item?.[ITEM_MEDIA_FIELD]).map(String);
  const merged = Array.from(new Set([...existingIds, String(mediaId)]));

  const token = await getToken();
  const url = buildUrl(ITEMS_COLLECTION, itemId);
  const payload = {
    [ITEM_MEDIA_FIELD]: merged.map((id) => Number(id) || id),
  };

  const result = await payloadFetch(url, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  const categoryId = item?.[ITEM_CATEGORY_FIELD]?.id ?? item?.[ITEM_CATEGORY_FIELD];
  if (categoryId != null) invalidateItemsCacheForCategory(categoryId);
  logger.info(`Attached media ${mediaId} to item ${itemId}`);
  return result;
}

export async function detachMediaFromItem(itemId, mediaId) {
  if (!itemId) throw new Error("Item ID is required.");
  if (!mediaId) throw new Error("Media ID is required.");

  const item = await getItem(itemId);
  const existingIds = relationToIdArray(item?.[ITEM_MEDIA_FIELD]).map(String);
  const filtered = existingIds.filter((id) => id !== String(mediaId));

  const token = await getToken();
  const url = buildUrl(ITEMS_COLLECTION, itemId);
  const payload = {
    [ITEM_MEDIA_FIELD]: filtered.map((id) => Number(id) || id),
  };

  const result = await payloadFetch(url, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  const categoryId = item?.[ITEM_CATEGORY_FIELD]?.id ?? item?.[ITEM_CATEGORY_FIELD];
  if (categoryId != null) invalidateItemsCacheForCategory(categoryId);
  logger.info(`Detached media ${mediaId} from item ${itemId}`);
  return result;
}
