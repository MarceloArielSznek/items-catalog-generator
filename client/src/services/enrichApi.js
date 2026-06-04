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

export async function fetchEnrichCandidates(itemId, orgId, orgName, { skipWebSearch = false } = {}) {
  const res = await fetch(`${BASE}/items/${itemId}/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, orgName, skipWebSearch }),
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

// ── Feedback ──────────────────────────────────────────────────────────────────

export async function saveFeedback(itemId, orgId, imageUrl, feedbackReason, feedbackDetail, rating, extra = {}) {
  const res = await fetch(`${BASE}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId, orgId, imageUrl, feedbackReason, feedbackDetail, rating, ...extra }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to save feedback");
  return body.data;
}

export async function saveFeedbackBatch(entries) {
  const res = await fetch(`${BASE}/feedback/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to save feedback batch");
  return body;
}

export async function fetchFeedbackStats(orgId) {
  const res = await fetch(`${BASE}/feedback/stats?orgId=${encodeURIComponent(orgId)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch stats");
  return body.data;
}

export async function refineWithOpus(orgId, orgName) {
  const res = await fetch(`${BASE}/feedback/refine`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, orgName }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Refinement failed");
  return body.data;
}

export async function fetchLearningInsights(orgId) {
  const res = await fetch(`${BASE}/feedback/learning?orgId=${encodeURIComponent(orgId)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch learning insights");
  return body.data;
}

export async function fetchAllFeedback(orgId) {
  const params = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  const res = await fetch(`${BASE}/feedback/all${params}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch feedback");
  return body.data;
}

export async function fetchTrainingItems(orgId, count = 10) {
  const res = await fetch(`${BASE}/training/random-items?orgId=${encodeURIComponent(orgId)}&count=${count}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch training items");
  return body.data;
}

// ── Auto-enrich batch (SSE streaming) ─────────────────────────────────────────

/**
 * Auto-enriches multiple items with intelligent defaults.
 * Calls onProgress and onLog for each event.
 * Returns results array.
 */
export function autoEnrichBatch(itemIds, orgId, orgName, { onProgress = () => {}, onLog = () => {}, onDone = () => {}, signal } = {}) {
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
              if (onDone) onDone(results); // Pass results to callback
              resolve(results);
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

// ── Org config (demo vs real client) ─────────────────────────────────────────

export async function fetchOrgConfig(orgId) {
  const res = await fetch(`${BASE}/org-config/${orgId}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch org config");
  return body.data;
}

export async function updateOrgConfig(orgId, config) {
  const res = await fetch(`${BASE}/org-config/${orgId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to update org config");
  return body.data;
}

// ── Base images ───────────────────────────────────────────────────────────────

export async function fetchBaseImages() {
  const res = await fetch(`${BASE}/base-images`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch base images");
  return body.data;
}

export async function applyLogoToBaseImages(orgId, itemIds) {
  const res = await fetch(`${BASE}/bulk-apply-logo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, itemIds }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Bulk apply logo failed");
  return body.data;
}

// ── AI catalog generation ─────────────────────────────────────────────────────

export async function fetchPreGeneratedIds(orgId) {
  const res = await fetch(`${BASE}/pre-generated/${orgId}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch pre-generated list");
  return body.data;
}

export async function refreshWebsiteContext(orgId) {
  const res = await fetch(`${BASE}/website-context/${orgId}`, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to fetch website context");
  return body.data;
}

// ── Enrichment package export / import ───────────────────────────────────────

export async function exportEnrichmentPackage(orgId) {
  const res = await fetch(`${BASE}/export-package/${orgId}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Export failed");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `enrichment-org-${orgId}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function applyEnrichmentPackage(orgId, file) {
  const form = new FormData();
  form.append("package", file);
  const res = await fetch(`${BASE}/apply-package/${orgId}`, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Import failed");
  return body.data;
}

export function generateAICatalog(orgId, orgName, itemIds, { force = false, quality = "medium", onProgress = () => {}, onDone = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/ai-catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, orgName, itemIds, force, quality }),
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
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") onProgress(data);
            else if (data.type === "done") { onDone(data); resolve(data); }
            else if (data.type === "error") reject(new Error(data.message));
          } catch { /* skip malformed */ }
        }
      }
    }).catch(reject);
  });
}
