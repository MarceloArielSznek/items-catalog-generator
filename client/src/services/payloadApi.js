import config from "../config.js";

const BASE = `${config.API_BASE_URL}/payload`;

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error || body.message || `Server error (${res.status})`);
  }
  return body;
}

export async function fetchCategories() {
  return request(`${BASE}/categories`);
}

export async function fetchItemsByCategory(categoryId) {
  return request(`${BASE}/categories/${categoryId}/items`);
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
