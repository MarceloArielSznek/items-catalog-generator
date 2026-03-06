import config from "../config.js";

async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (options.raw) return response;

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Server error (${response.status})`);
  }
  return result;
}

export async function createScene({ name, background, logo, logoPosition }) {
  const formData = new FormData();
  formData.append("name", name);
  formData.append("background", background);
  formData.append("logo", logo);
  if (logoPosition) formData.append("logoPosition", logoPosition);

  return request(`${config.API_BASE_URL}/scenes`, { method: "POST", body: formData });
}

export async function listScenes() {
  return request(`${config.API_BASE_URL}/scenes`);
}

export async function getSceneById(id) {
  return request(`${config.API_BASE_URL}/scenes/${id}`);
}

export async function deleteScene(id) {
  return request(`${config.API_BASE_URL}/scenes/${id}`, { method: "DELETE" });
}

export async function generateCatalogImage({ background, item, logo, itemName, instruction, logoPosition, mode, format }) {
  const formData = new FormData();
  formData.append("background", background);
  formData.append("item", item);
  formData.append("logo", logo);
  if (itemName?.trim()) formData.append("itemName", itemName.trim());
  if (instruction?.trim()) formData.append("instruction", instruction.trim());
  if (logoPosition) formData.append("logoPosition", logoPosition);
  if (mode) formData.append("mode", mode);
  if (format) formData.append("format", format);

  return request(`${config.API_BASE_URL}/generate-catalog-image`, { method: "POST", body: formData });
}

export async function generateWithScene({ sceneId, item, itemName, instruction, logoPosition, mode, format, itemScale, shadowIntensity }) {
  const formData = new FormData();
  formData.append("item", item);
  if (itemName?.trim()) formData.append("itemName", itemName.trim());
  if (instruction?.trim()) formData.append("instruction", instruction.trim());
  if (logoPosition) formData.append("logoPosition", logoPosition);
  if (mode) formData.append("mode", mode);
  if (format) formData.append("format", format);
  if (itemScale != null) formData.append("itemScale", String(itemScale));
  if (shadowIntensity != null) formData.append("shadowIntensity", String(shadowIntensity));

  return request(`${config.API_BASE_URL}/generate-with-scene/${sceneId}`, { method: "POST", body: formData });
}

export async function removeBackground(itemFile) {
  const formData = new FormData();
  formData.append("item", itemFile);
  return request(`${config.API_BASE_URL}/remove-background`, { method: "POST", body: formData });
}

// ── Scene Update ──

export async function updateScene(id, { name, background, logo, logoPosition }) {
  const formData = new FormData();
  if (name != null) formData.append("name", name);
  if (logoPosition != null) formData.append("logoPosition", logoPosition);
  if (background) formData.append("background", background);
  if (logo) formData.append("logo", logo);
  return request(`${config.API_BASE_URL}/scenes/${id}`, { method: "PATCH", body: formData });
}

// ── Library ──

export async function listAlbums() {
  return request(`${config.API_BASE_URL}/library/albums`);
}

export async function createAlbum({ name, sceneId }) {
  return request(`${config.API_BASE_URL}/library/albums`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, sceneId }),
  });
}

export async function getAlbumWithItems(albumId) {
  return request(`${config.API_BASE_URL}/library/albums/${albumId}`);
}

export async function updateAlbum(albumId, updates) {
  return request(`${config.API_BASE_URL}/library/albums/${albumId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function deleteAlbum(albumId) {
  return request(`${config.API_BASE_URL}/library/albums/${albumId}`, { method: "DELETE" });
}

export async function saveLibraryItem({ albumId, title, description, imageUrl, filename, sceneId, itemScale, shadowIntensity, mode, format }) {
  return request(`${config.API_BASE_URL}/library/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumId, title, description, imageUrl, filename, sceneId, itemScale, shadowIntensity, mode, format }),
  });
}

export async function updateLibraryItem(itemId, { albumId, title, description }) {
  return request(`${config.API_BASE_URL}/library/items/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumId, title, description }),
  });
}

export async function moveLibraryItem(itemId, fromAlbumId, toAlbumId) {
  return request(`${config.API_BASE_URL}/library/items/${itemId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromAlbumId, toAlbumId }),
  });
}

export async function deleteLibraryItem(itemId, albumId) {
  return request(`${config.API_BASE_URL}/library/items/${itemId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumId }),
  });
}

export async function searchLibrary(query) {
  return request(`${config.API_BASE_URL}/library/search?q=${encodeURIComponent(query)}`);
}

// ── Downloads ──

export async function downloadZip(filenames) {
  const response = await fetch(`${config.API_BASE_URL}/download-zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filenames }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || "Failed to download ZIP");
  }

  return response.blob();
}
