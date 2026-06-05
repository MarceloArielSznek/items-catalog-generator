import env, { validateConfig } from "../config/env.js";
import logger from "../utils/logger.js";
import { getMenaiaApiKey, probeMenaiaAuth } from "./menaiaAuthService.js";

const API_PREFIX = "/v1";
const WORK_AREAS_COLLECTION = "work-areas";
const CATEGORIES_COLLECTION = "item-categories";
const ITEMS_COLLECTION = "items";
const FACTORS_COLLECTION = "factors";
const ADDITIONAL_COSTS_COLLECTION = "additional-costs";
const ITEM_MEDIA_FIELD = "media";
const ITEM_NAME_FIELD = "name";
const ITEM_DESCRIPTION_FIELD = "itemInfo";
const ITEM_CATEGORY_FIELD = "category";
const ITEM_UNIT_FIELD = "unit";
const ITEM_MATERIAL_COST_FIELD = "materialCost";
const PAGE_SIZE = 100;
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
  const parts = [env.MENAIA_API_URL, API_PREFIX, ...segments]
    .filter(Boolean)
    .map((s) => String(s).replace(/^\/+|\/+$/g, ""));
  return parts.join("/");
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
  const { timeout: requestTimeout, ...fetchOptions } = options;
  const timeout = requestTimeout || env.MENAIA_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const headers = { ...(fetchOptions.headers || {}) };

  try {
    const res = await fetch(url, { ...fetchOptions, headers, signal: controller.signal });
    const body = parseJsonBody(await res.text());
    if (!res.ok) {
      // Static API key — no cookie refresh/retry. Surface 4xx/5xx as errors.
      const msg = body?.message || body?.statusCode || body || `Menaia API ${res.status}`;
      throw new Error(typeof msg === "string" ? msg : `Menaia API ${res.status}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function getToken() {
  validateConfig();
  return getMenaiaApiKey();
}

function authHeaders() {
  return {
    Authorization: `Bearer ${getMenaiaApiKey()}`,
    "Content-Type": "application/json",
  };
}

async function fetchAllPages(collection, params = {}) {
  validateConfig();
  const docs = [];
  let page = 1;
  let pageCount = 1;

  do {
    const qs = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...params,
    });
    const url = `${buildUrl(collection)}?${qs}`;
    const data = await payloadFetch(url, { headers: authHeaders() });

    docs.push(...(data?.data || []));
    pageCount = data?.meta?.pagination?.pageCount ?? 1;
    page += 1;
  } while (page <= pageCount);

  return docs;
}

// ── Read-shape adapters (NestJS /v1 → client-facing shapes) ───────────────────

/**
 * Map a hydrated `/v1` item to the shape the existing routes/client consume:
 * a single `category` ({id,name}) derived from `itemCategories[0]`, a `media`
 * array of {id,url,...}, and `factors`/`additionalCosts` left as hydrated
 * arrays. Preserves every other field on the item.
 */
function adaptItem(item) {
  if (!item || typeof item !== "object") return item;
  const categories = Array.isArray(item.itemCategories) ? item.itemCategories : [];
  const primaryCategory = categories[0]
    ? { id: categories[0].id, name: categories[0].name }
    : null;
  return {
    ...item,
    [ITEM_CATEGORY_FIELD]: primaryCategory,
    [ITEM_MEDIA_FIELD]: Array.isArray(item.media) ? item.media : [],
  };
}

// ── Work areas ────────────────────────────────────────────────────────────────

export async function getWorkAreas(orgId) {
  const key = orgId ?? "__all__";
  const entry = workAreasCache.get(key);
  if (entry && Date.now() < entry.expires) {
    logger.info(`Work areas from cache (${entry.data.length} items, org=${key})`);
    return entry.data;
  }
  const docs = await fetchAllPages(WORK_AREAS_COLLECTION);
  const workAreas = docs.map((doc) => ({ ...doc, id: doc.id, name: doc.name }));
  logger.info(`Fetched ${workAreas.length} work areas from Menaia (org=${key})`);
  workAreasCache.set(key, { data: workAreas, expires: Date.now() + CACHE_TTL_MS });
  return workAreas;
}

export async function getWorkArea(id) {
  if (!id) throw new Error("Work area ID is required.");
  const url = buildUrl(WORK_AREAS_COLLECTION, id);
  return payloadFetch(url, { headers: authHeaders() });
}

export async function createWorkArea(body) {
  const url = buildUrl(WORK_AREAS_COLLECTION);
  const result = await payloadFetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  invalidateWorkAreasCache();
  logger.info("Created work area in Menaia", { id: result?.id });
  return result;
}

export async function updateWorkArea(id, body) {
  if (!id) throw new Error("Work area ID is required.");
  const url = buildUrl(WORK_AREAS_COLLECTION, id);
  const result = await payloadFetch(url, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  invalidateWorkAreasCache();
  logger.info("Updated work area in Menaia", { id });
  return result;
}

export async function deleteWorkArea(id) {
  if (!id) throw new Error("Work area ID is required.");
  const url = buildUrl(WORK_AREAS_COLLECTION, id);
  await payloadFetch(url, { method: "DELETE", headers: authHeaders() });
  invalidateWorkAreasCache();
  logger.info("Deleted work area from Menaia", { id });
}

export async function getCategoriesByWorkArea(workAreaId) {
  if (!workAreaId) throw new Error("Work area ID is required.");
  const entry = categoriesByWorkAreaCache.get(String(workAreaId));
  if (entry && Date.now() < entry.expires) {
    logger.info(`Categories for work area ${workAreaId} from cache (${entry.data.length} items)`);
    return entry.data;
  }

  // /v1 item-categories carry `workAreaIds`; filter to those linked to this WA.
  const docs = await fetchAllPages(CATEGORIES_COLLECTION);
  const target = String(workAreaId);
  const categories = docs
    .filter((doc) => (doc?.workAreaIds || []).map(String).includes(target))
    .map((doc) => ({ id: doc.id, name: doc.name }));

  logger.info(`Fetched ${categories.length} categories for work area ${workAreaId}`);
  categoriesByWorkAreaCache.set(String(workAreaId), {
    data: categories,
    expires: Date.now() + CACHE_TTL_MS,
  });
  return categories;
}

// ── Item categories ───────────────────────────────────────────────────────────

export async function getCategories(orgId) {
  const cached = getCachedCategories(orgId);
  if (cached) {
    logger.info(`Categories from cache (${cached.length} items, org=${orgId ?? "__all__"})`);
    return cached;
  }
  const categories = await fetchAllPages(CATEGORIES_COLLECTION);
  logger.info(`Fetched ${categories.length} categories from Menaia (org=${orgId ?? "__all__"})`);
  setCachedCategories(orgId, categories);
  return categories;
}

export async function getCategory(id) {
  if (!id) throw new Error("Category ID is required.");
  const url = buildUrl(CATEGORIES_COLLECTION, id);
  return payloadFetch(url, { headers: authHeaders() });
}

export async function createCategory(body) {
  const url = buildUrl(CATEGORIES_COLLECTION);
  const result = await payloadFetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  invalidateCategoriesCache();
  invalidateWorkAreasCache();
  logger.info("Created item category in Menaia", { id: result?.id });
  return result;
}

export async function updateCategory(id, body) {
  if (!id) throw new Error("Category ID is required.");
  const url = buildUrl(CATEGORIES_COLLECTION, id);
  const result = await payloadFetch(url, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  invalidateCategoriesCache();
  invalidateWorkAreasCache();
  logger.info("Updated item category in Menaia", { id });
  return result;
}

export async function deleteCategory(id) {
  if (!id) throw new Error("Category ID is required.");
  const url = buildUrl(CATEGORIES_COLLECTION, id);
  await payloadFetch(url, { method: "DELETE", headers: authHeaders() });
  invalidateCategoriesCache();
  invalidateWorkAreasCache();
  logger.info("Deleted item category from Menaia", { id });
}

// ── Items ─────────────────────────────────────────────────────────────────────

export async function getItemsByCategory(categoryId) {
  const cached = getCachedItems(categoryId);
  if (cached) {
    logger.info(`Items for category ${categoryId} from cache (${cached.length} items)`);
    return cached;
  }
  const docs = await fetchAllPages(ITEMS_COLLECTION, { itemCategoryId: String(categoryId) });
  const items = docs.map(adaptItem);

  logger.info(`Fetched ${items.length} items for category ${categoryId}`);
  setCachedItems(categoryId, items);
  return items;
}

export async function getAllItems() {
  const docs = await fetchAllPages(ITEMS_COLLECTION);
  return docs.map((doc) => ({
    id: doc.id,
    name: doc.name ?? String(doc.id),
  }));
}

export async function getAllItemsForOrg(orgId) {
  const categories = await getCategories(orgId);
  const allItems = [];
  for (const cat of categories) {
    const items = await getItemsByCategory(cat.id);
    allItems.push(...items);
  }
  return allItems;
}

export async function getItem(itemId) {
  if (!itemId) throw new Error("Item ID is required.");
  const url = buildUrl(ITEMS_COLLECTION, itemId);
  const item = await payloadFetch(url, { headers: authHeaders() });
  return adaptItem(item);
}

export async function getFactors() {
  try {
    const docs = await fetchAllPages(FACTORS_COLLECTION);
    return docs.map((doc) => ({
      id: doc.id,
      label: doc.name ?? String(doc.id),
    }));
  } catch (err) {
    logger.warn("Failed to fetch factors from Menaia:", err.message);
    return [];
  }
}

export async function getAdditionalCosts() {
  try {
    const docs = await fetchAllPages(ADDITIONAL_COSTS_COLLECTION);
    return docs.map((doc) => ({
      id: doc.id,
      label: doc.name ?? String(doc.id),
    }));
  } catch (err) {
    logger.warn("Failed to fetch additional costs from Menaia:", err.message);
    return [];
  }
}

export async function getOrganizations() {
  try {
    const url = buildUrl("organization", "me");
    const org = await payloadFetch(url, { headers: authHeaders() });
    if (!org?.id) return [];
    return [{ id: org.id, name: org.name ?? String(org.id) }];
  } catch (err) {
    logger.warn("Failed to fetch organization from Menaia:", err.message);
    return [];
  }
}

export async function updateItem(itemId, body) {
  if (!itemId) throw new Error("Item ID is required.");
  const url = buildUrl(ITEMS_COLLECTION, itemId);

  const payload = {};
  if (body.name != null) payload[ITEM_NAME_FIELD] = String(body.name).trim();
  if (body.description != null) payload[ITEM_DESCRIPTION_FIELD] = String(body.description).trim();
  if (body.itemInfo != null) payload[ITEM_DESCRIPTION_FIELD] = String(body.itemInfo).trim();
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
    if (!Number.isNaN(n)) payload.multiplierOverride = n;
  }
  if (typeof body.subItem === "boolean") payload.subItem = body.subItem;
  if (typeof body.requiresInfo === "boolean") payload.requiresInfo = body.requiresInfo;
  // Payload `factors`/`additional_costs` → NestJS `factorIds`/`additionalCostIds`.
  if (body.factorIds !== undefined) payload.factorIds = body.factorIds;
  else if (body.factors !== undefined) payload.factorIds = body.factors;
  if (Array.isArray(body.additionalCostIds)) payload.additionalCostIds = body.additionalCostIds;
  else if (Array.isArray(body.additional_costs)) payload.additionalCostIds = body.additional_costs;

  const reserved = new Set([
    "description",
    "itemInfo",
    "laborHours",
    "multiplierOverride",
    "subItem",
    "requiresInfo",
    "factors",
    "factorIds",
    "additional_costs",
    "additionalCostIds",
    "media",
    "mediaIds",
    "category",
    "itemCategories",
  ]);
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
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  const adapted = adaptItem(result);
  const categoryId = adapted?.[ITEM_CATEGORY_FIELD]?.id ?? null;
  if (categoryId != null) invalidateItemsCacheForCategory(categoryId);
  logger.info(`Updated item ${itemId} in Menaia`);
  return adapted;
}

// ── Item media (item-scoped, 3-step presigned upload) ─────────────────────────

function mediaToIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((m) => (m && typeof m === "object" ? m.id : m))
    .filter((id) => id != null);
}

/**
 * Upload a media file and attach it to an item via the NestJS 3-step flow:
 *   1. POST /v1/items/:itemId/media/upload-url → presigned PUT URL.
 *   2. PUT the raw bytes to that URL (presigned S3; not bearer-authed).
 *   3. POST /v1/items/:itemId/media/register → links media→item.
 *
 * @param {string|number} itemId
 * @param {Buffer} fileBuffer
 * @param {string} filename
 * @param {string} mimeType
 * @returns {Promise<{ mediaId: number, publicUrl: string|null }>}
 */
export async function uploadItemMedia(itemId, fileBuffer, filename, mimeType) {
  if (!itemId) throw new Error("Item ID is required.");
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
    throw new Error("File buffer is required.");
  }
  const contentType = mimeType || "application/octet-stream";
  const originalFilename = filename || "upload.bin";
  const filesize = fileBuffer.length;

  // Step 1: presign.
  const presign = await payloadFetch(buildUrl(ITEMS_COLLECTION, itemId, "media", "upload-url"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ mimeType: contentType, originalFilename, filesize }),
  });

  // Step 2: PUT bytes to the presigned URL (no bearer).
  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.uploadHeaders,
    body: fileBuffer,
  });
  if (!putRes.ok) {
    throw new Error(`Media upload (PUT) failed (${putRes.status})`);
  }

  // Step 3: register (auto-attaches to the item).
  const registered = await payloadFetch(buildUrl(ITEMS_COLLECTION, itemId, "media", "register"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      prefix: presign.prefix,
      filename: presign.filename,
      mimeType: contentType,
      filesize,
    }),
  });

  logger.info(`Uploaded + attached media ${registered?.mediaId} to item ${itemId}`);
  return { mediaId: registered?.mediaId, publicUrl: registered?.publicUrl ?? null };
}

/**
 * Detach a media object from an item by reading its current media, removing the
 * target id, and PATCHing the remaining `mediaIds`.
 *
 * @param {string|number} itemId
 * @param {string|number} mediaId
 * @returns {Promise<object>} the updated (adapted) item
 */
export async function detachMediaFromItem(itemId, mediaId) {
  if (!itemId) throw new Error("Item ID is required.");
  if (!mediaId) throw new Error("Media ID is required.");

  const item = await getItem(itemId);
  const existingIds = mediaToIdArray(item?.[ITEM_MEDIA_FIELD]).map(String);
  const filtered = existingIds
    .filter((id) => id !== String(mediaId))
    .map((id) => Number(id) || id);

  const url = buildUrl(ITEMS_COLLECTION, itemId);
  const result = await payloadFetch(url, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ mediaIds: filtered }),
  });
  const adapted = adaptItem(result);
  const categoryId = adapted?.[ITEM_CATEGORY_FIELD]?.id ?? null;
  if (categoryId != null) invalidateItemsCacheForCategory(categoryId);
  logger.info(`Detached media ${mediaId} from item ${itemId}`);
  return adapted;
}
