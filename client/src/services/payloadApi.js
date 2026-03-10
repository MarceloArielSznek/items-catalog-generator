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

export async function fetchWorkAreas() {
  const now = Date.now();
  if (workAreasCache.data && now < workAreasCache.expires) {
    return workAreasCache.data;
  }
  const body = await request(`${BASE}/work-areas`);
  const data = body.data ?? body;
  workAreasCache.data = { ...body, data };
  workAreasCache.expires = now + CACHE_TTL_MS;
  return workAreasCache.data;
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

export async function fetchCategories() {
  const now = Date.now();
  if (categoriesCache.data && now < categoriesCache.expires) {
    return categoriesCache.data;
  }
  const body = await request(`${BASE}/categories`);
  const data = body.data ?? body;
  categoriesCache.data = { ...body, data };
  categoriesCache.expires = now + CACHE_TTL_MS;
  return categoriesCache.data;
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

export async function fetchItem(itemId) {
  return request(`${BASE}/items/${itemId}`);
}

export async function updatePayloadItem(itemId, { name, description }) {
  return request(`${BASE}/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
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
