import config from "../config.js";

const BASE = `${config.API_BASE_URL}/payload`;
const CACHE_TTL_MS = 2 * 60 * 1000; // 5 min

const workAreasCache = { data: null, expires: 0 };
const categoriesByWACache = new Map(); // workAreaId -> { data, expires }
const categoriesCache = { data: null, expires: 0 };
const itemsCache = new Map(); // categoryId -> { data, expires }

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || body.message || `Server error (${res.status})`);
  }
  return body;
}

export function invalidatePayloadCache(categoryId) {
  workAreasCache.data = null;
  workAreasCache.expires = 0;
  categoriesByWACache.clear();
  categoriesCache.data = null;
  categoriesCache.expires = 0;
  if (categoryId != null) itemsCache.delete(String(categoryId));
  else itemsCache.clear();
}

export async function fetchWorkAreas(orgId) {
  const cacheKey = orgId ?? "__all__";
  const now = Date.now();
  // use the existing cache object keyed by orgId via a nested map
  const cached = workAreasCache[cacheKey];
  if (cached && now < cached.expires) return cached.data;
  const url = orgId ? `${BASE}/work-areas?orgId=${orgId}` : `${BASE}/work-areas`;
  const body = await request(url);
  const data = body.data ?? body;
  const result = { ...body, data };
  workAreasCache[cacheKey] = { data: result, expires: now + CACHE_TTL_MS };
  return result;
}

export async function fetchCategoriesByWorkArea(workAreaId) {
  const now = Date.now();
  const entry = categoriesByWACache.get(String(workAreaId));
  if (entry && now < entry.expires) {
    return entry.data;
  }
  const body = await request(`${BASE}/work-areas/${workAreaId}/categories`);
  const data = body.data ?? body;
  const result = { ...body, data };
  categoriesByWACache.set(String(workAreaId), {
    data: result,
    expires: now + CACHE_TTL_MS,
  });
  return result;
}

export async function fetchCategories(orgId) {
  const cacheKey = orgId ?? "__all__";
  const now = Date.now();
  const cached = categoriesCache[cacheKey];
  if (cached && now < cached.expires) return cached.data;
  const url = orgId ? `${BASE}/categories?orgId=${orgId}` : `${BASE}/categories`;
  const body = await request(url);
  const data = body.data ?? body;
  const result = { ...body, data };
  categoriesCache[cacheKey] = { data: result, expires: now + CACHE_TTL_MS };
  return result;
}

export async function fetchWorkArea(id) {
  const body = await request(`${BASE}/work-areas/${id}`);
  return body.data ?? body;
}

export async function createWorkArea(payload) {
  const body = await request(`${BASE}/work-areas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  invalidatePayloadCache();
  return body.data ?? body;
}

export async function updateWorkArea(id, payload) {
  const body = await request(`${BASE}/work-areas/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  invalidatePayloadCache();
  return body.data ?? body;
}

export async function deleteWorkArea(id) {
  await request(`${BASE}/work-areas/${id}`, { method: "DELETE" });
  invalidatePayloadCache();
}

export async function fetchCategory(id) {
  const body = await request(`${BASE}/categories/${id}`);
  return body.data ?? body;
}

export async function createCategory(payload) {
  const body = await request(`${BASE}/categories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  invalidatePayloadCache();
  return body.data ?? body;
}

export async function updateCategory(id, payload) {
  const body = await request(`${BASE}/categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  invalidatePayloadCache();
  return body.data ?? body;
}

export async function deleteCategory(id) {
  await request(`${BASE}/categories/${id}`, { method: "DELETE" });
  invalidatePayloadCache();
}

export async function fetchItemsByCategory(categoryId) {
  const now = Date.now();
  const entry = itemsCache.get(String(categoryId));
  if (entry && now < entry.expires) {
    return entry.data;
  }
  const body = await request(`${BASE}/categories/${categoryId}/items`);
  const data = body.data ?? body;
  itemsCache.set(String(categoryId), {
    data: { ...body, data },
    expires: now + CACHE_TTL_MS,
  });
  return itemsCache.get(String(categoryId)).data;
}

export async function fetchAllItems() {
  const body = await request(`${BASE}/items`);
  return body.data ?? body ?? [];
}

export async function fetchItem(itemId) {
  return request(`${BASE}/items/${itemId}`);
}

export async function fetchFactors() {
  const body = await request(`${BASE}/factors`);
  return body.data ?? body ?? [];
}

export async function fetchAdditionalCosts() {
  const body = await request(`${BASE}/additional-costs`);
  return body.data ?? body ?? [];
}

export async function fetchOrganizations() {
  const body = await request(`${BASE}/organizations`);
  return body.data ?? body ?? [];
}

export async function updatePayloadItem(itemId, payload) {
  return request(`${BASE}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function uploadItemMedia(itemId, file) {
  const formData = new FormData();
  formData.append("file", file);
  return request(`${BASE}/items/${itemId}/media`, {
    method: "POST",
    body: formData,
  });
}

export async function detachItemMedia(itemId, mediaId) {
  return request(`${BASE}/items/${itemId}/media/${mediaId}`, {
    method: "DELETE",
  });
}
