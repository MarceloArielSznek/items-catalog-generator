import { menaiaHeaders } from './menaiaSettings.js';

const BASE = '/api/orgs';

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...menaiaHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Request failed');
  return json.data;
}

export const listOrgs = () => req('GET', '/');
export const getOrg = (slug) => req('GET', `/${slug}`);
export const saveOrg = (org) => req('POST', '/', { org });
export const patchOrg = (slug, patch) => req('PATCH', `/${slug}`, patch);
export const deleteOrg = (slug) => req('DELETE', `/${slug}`);
export const planOrgDeployment = (slug, options) =>
  req('POST', `/${slug}/deploy/plan`, options);
export const deployOrg = (slug, options) =>
  req('POST', `/${slug}/deploy`, options);

// Downloads the post-deploy users .xlsx and triggers a browser save dialog.
export async function exportDeployUsers(slug) {
  const res = await fetch(`${BASE}/${slug}/deploy/export`);
  if (!res.ok) {
    let message = 'Export failed';
    try { message = (await res.json()).error || message; } catch { /* non-JSON */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `${slug}-deploy-users.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const updateOrgSettings = (slug, patch) =>
  req('PATCH', `/${slug}/settings`, patch);

export const updateOrgResources = (slug, resources) =>
  req('PATCH', `/${slug}/resources`, resources);

export function uploadItemImage(slug, categoryName, itemName, file) {
  const form = new FormData();
  form.append('image', file);
  form.append('categoryName', categoryName);
  form.append('itemName', itemName);
  return fetch(`/api/orgs/${slug}/resources/item-image`, { method: 'POST', body: form })
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j; });
}

export function deleteItemImage(slug, categoryName, itemName) {
  return fetch(`/api/orgs/${slug}/resources/item-image`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryName, itemName }),
  }).then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error); return j; });
}

export function getImageProviders() {
  return fetch('/api/orgs/image-providers')
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

export function generateItemImage(slug, categoryName, itemName, notes, { provider, model, quality, comment = '' } = {}) {
  return fetch(`/api/orgs/${slug}/resources/item-image/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryName, itemName, notes, provider, model, quality, comment }),
  }).then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error); return j; });
}

export function suggestImageStyle(slug) {
  return fetch(`/api/orgs/${slug}/image-style/suggest`, { method: 'POST' })
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

export function editItemImage(slug, categoryName, itemName, feedback) {
  return fetch(`/api/orgs/${slug}/resources/item-image/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryName, itemName, feedback }),
  }).then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error); return j; });
}

export function fetchItemCandidates(slug, categoryName, itemName, { count = 3, contextHint = '' } = {}) {
  return fetch(`/api/orgs/${slug}/resources/item-image/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryName, itemName, count, contextHint }),
  }).then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

export function selectItemImage(slug, categoryName, itemName, imageUrl, thumbUrl) {
  return fetch(`/api/orgs/${slug}/resources/item-image/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ categoryName, itemName, imageUrl, thumbUrl }),
  }).then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error); return j; });
}

export function listOrgLogos(slug) {
  return fetch(`/api/orgs/${slug}/logo`)
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

export function listLogoSources(slug) {
  return req('GET', `/${slug}/logo-sources`);
}

export function importOrgLogo(slug, sourceSlug) {
  return req('POST', `/${slug}/import-logo`, { sourceSlug });
}

export function uploadOrgLogo(slug, variant, file) {
  const form = new FormData();
  form.append('logo', file);
  return fetch(`/api/orgs/${slug}/logo/${variant}`, { method: 'POST', body: form })
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j; });
}

export function deleteOrgLogo(slug, variant) {
  return fetch(`/api/orgs/${slug}/logo/${variant}`, { method: 'DELETE' })
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j; });
}

export function setLogoPlaceholder(slug, label) {
  return fetch(`/api/orgs/${slug}/logo-placeholder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  }).then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

export function generateOrgLogo(slug, { provider, model } = {}) {
  return fetch(`/api/orgs/${slug}/generate-logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, model }),
  }).then((r) => r.json()).then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

export function cloneToReal(slug, realData) {
  return req('POST', `/${slug}/clone-to-real`, realData);
}

export function bulkApplyOrgLogo(slug, overlay = {}) {
  return fetch(`/api/orgs/${slug}/bulk-logo-apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overlay),
  })
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

export function bulkGenerateImages(slug, categoryName, { mode = 'generate', provider, model, quality, overwrite = false, comment = '', onProgress = () => {}, onDone = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`/api/orgs/${slug}/resources/bulk-generate-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryName, mode, provider, model, quality, overwrite, comment }),
    }).then(async (res) => {
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        return reject(new Error(j.error || `Error ${res.status}`));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'progress') onProgress(data);
            else if (data.type === 'done') { onDone(data.results); resolve(data.results); }
          } catch { /* skip */ }
        }
      }
    }).catch(reject);
  });
}
