import config from "../config.js";

const BASE = `${config.API_BASE_URL}/enrich`;

// ── Logo ─────────────────────────────────────────────────────────────────────

export async function uploadOrgLogo(orgId, file) {
  const form = new FormData();
  form.append("logo", file);
  const res = await fetch(`${BASE}/logo/${orgId}`, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Logo upload failed");
  return body;
}

export function proxyImageUrl(url) {
  if (!url) return url;
  if (url.startsWith("/") || url.startsWith("data:")) return url;
  return `${BASE}/proxy?url=${encodeURIComponent(url)}`;
}

export function orgLogoUrl(orgId, variant = null) {
  return variant
    ? `${BASE}/logos/${orgId}/${variant}`
    : `${BASE}/logo/${orgId}`;
}

export async function fetchLogoVariants(orgId) {
  const res = await fetch(`${BASE}/logos/${orgId}`);
  const body = await res.json();
  if (!res.ok) return [];
  return body.data || [];
}

export async function uploadLogoVariant(orgId, variant, file) {
  const form = new FormData();
  form.append("logo", file);
  const res = await fetch(`${BASE}/logos/${orgId}/${variant}`, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Upload failed");
  return body;
}

export async function deleteLogoVariant(orgId, variant) {
  const res = await fetch(`${BASE}/logos/${orgId}/${variant}`, { method: "DELETE" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Delete failed");
  return body;
}

// ── Wizard: get candidates ────────────────────────────────────────────────────

export async function fetchEnrichCandidates(itemId, orgId, orgName) {
  const res = await fetch(`${BASE}/items/${itemId}/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, orgName }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch candidates");
  return body.data;
}

// ── Wizard: apply selected image + settings ───────────────────────────────────

export async function applyEnrich(itemId, orgId, { imageUrl, description, lighting, logoPosition, logoScale, logoVariant }) {
  const res = await fetch(`${BASE}/items/${itemId}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, imageUrl, description, lighting, logoPosition, logoScale, logoVariant }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Apply failed");
  return body.data;
}

// ── Wizard: generate image with DALL-E 3 ─────────────────────────────────────

export async function generateEnrichImage(itemId, { itemName, categoryName, description }) {
  const res = await fetch(`${BASE}/items/${itemId}/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemName, categoryName, description }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Image generation failed");
  return body.data;
}

// ── Auto-enrich batch (SSE streaming) ─────────────────────────────────────────

/**
 * Auto-enriches multiple items with intelligent defaults.
 * Calls onProgress and onLog for each event.
 * Returns results array.
 */
export function autoEnrichBatch(itemIds, orgId, orgName, { onProgress = () => {}, onLog = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/items/batch/auto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds, orgId, orgName }),
      signal,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return reject(new Error(body.error || `Server error ${res.status}`));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let results = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") onProgress(data);
            else if (data.type === "log") onLog(data.message);
            else if (data.type === "done") {
              results = data.results || [];
              resolve(data);
            }
            else if (data.type === "error") reject(new Error(data.message));
          } catch { /* skip malformed */ }
        }
      }
    }).catch(reject);
  });
}

// ── Enrich item (SSE streaming) ───────────────────────────────────────────────

/**
 * Starts the auto-enrich pipeline for one item.
 * Calls onProgress({ step, message }) for each progress event.
 * Returns the final result object.
 */
export function enrichItem(itemId, orgId, orgName, { onProgress = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/items/${itemId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, orgName }),
      signal,
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return reject(new Error(body.error || `Server error ${res.status}`));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") onProgress(data);
            else if (data.type === "done") resolve(data);
            else if (data.type === "error") reject(new Error(data.message));
          } catch { /* skip malformed */ }
        }
      }
    }).catch(reject);
  });
}
