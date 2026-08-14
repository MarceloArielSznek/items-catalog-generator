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

// Streams the deploy over Server-Sent Events: `onStep(entry)` fires for every
// step as it happens; the promise resolves with the final result object
// ({ success, log, actions, credentials, error }). Pre-stream validation errors
// (non-SSE JSON response) reject the promise.
export function deployOrg(slug, options, { onStep = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/${slug}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...menaiaHeaders() },
      body: JSON.stringify(options),
    }).then(async (res) => {
      if (!(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
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
            if (data.type === 'step') onStep(data.entry);
            else if (data.type === 'done') resolve(data.result);
          } catch { /* skip malformed frame */ }
        }
      }
    }).catch(reject);
  });
}

// Dry run for the demo-data populate: authenticates, resolves the live target
// org, and returns what would be created + a confirmation token. Read-only.
export const planDemoData = (slug, options) =>
  req('POST', `/${slug}/deploy/demo-data/plan`, options);

// Add an empty work area (industry) to a multi-industry org.
export const addWorkArea = (slug, name) =>
  req('POST', `/${slug}/work-areas`, { name });

// Generate one work area's catalog (categories + items) via SSE. `onStep(entry)`
// fires per step; resolves with the final result ({ success, addedCats, addedItems, error }).
export function generateWorkAreaCatalog(slug, options, { onStep = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/${slug}/work-areas/generate-catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...menaiaHeaders() },
      body: JSON.stringify(options),
    }).then(async (res) => {
      if (!(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
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
            if (data.type === 'step') onStep(data.entry);
            else if (data.type === 'done') resolve(data.result);
          } catch { /* skip malformed frame */ }
        }
      }
    }).catch(reject);
  });
}

// Post-deploy population: streams avatar + lead seeding over SSE, same shape as
// deployOrg. `onStep(entry)` fires per step; resolves with the final result
// ({ success, log, actions, error }).
export function seedDemoData(slug, options, { onStep = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/${slug}/deploy/demo-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...menaiaHeaders() },
      body: JSON.stringify(options),
    }).then(async (res) => {
      if (!(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
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
            if (data.type === 'step') onStep(data.entry);
            else if (data.type === 'done') resolve(data.result);
          } catch { /* skip malformed frame */ }
        }
      }
    }).catch(reject);
  });
}

// Re-attach item categories to work areas on an already-deployed org (fixes orgs
// deployed while the Menaia work-area↔category bug was live). SSE, same shape as
// deployOrg. Takes the same options (expectedOrganizationId + confirmation + auth).
export function relinkWorkAreas(slug, options, { onStep = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/${slug}/deploy/relink-work-areas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...menaiaHeaders() },
      body: JSON.stringify(options),
    }).then(async (res) => {
      if (!(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
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
            if (data.type === 'step') onStep(data.entry);
            else if (data.type === 'done') resolve(data.result);
          } catch { /* skip malformed frame */ }
        }
      }
    }).catch(reject);
  });
}

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

// AI: regenerate richer customer-facing item descriptions (all items, or one
// category). Returns the updated org.
export const improveItemDescriptions = (slug, categoryName) =>
  req('POST', `/${slug}/improve-descriptions`, { categoryName });

// AI: regenerate the proposal content block (about, terms, email template) and
// apply it to every branch. Returns the updated org.
export const generateProposalContent = (slug) =>
  req('POST', `/${slug}/generate-proposal-content`);

// ── Users ─────────────────────────────────────────────────────────────────────

// Save manual edits to the org's users array. Returns the updated org.
export const updateOrgUsers = (slug, users) =>
  req('PATCH', `/${slug}/users`, { users });

// AI: generate realistic name + about for users (all, or a subset by email).
// Returns the updated org.
export const generateUserIdentities = (slug, emails) =>
  req('POST', `/${slug}/users/generate-identities`, emails ? { emails } : {});

// AI: generate a headshot avatar for one user. Returns { avatarUrl, email }.
export const generateUserAvatar = (slug, email, { provider, model, quality } = {}) =>
  req('POST', `/${slug}/users/avatar/generate`, { email, provider, model, quality });

// Manual avatar upload for one user. Returns { avatarUrl, email }.
export function uploadUserAvatar(slug, email, file) {
  const form = new FormData();
  form.append('avatar', file);
  form.append('email', email);
  return fetch(`/api/orgs/${slug}/users/avatar/upload`, { method: 'POST', body: form })
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

// Remove a user's avatar. Returns the updated org.
export const deleteUserAvatar = (slug, email) =>
  req('DELETE', `/${slug}/users/avatar`, { email });

// AI: bulk-generate avatars for all users (SSE). onProgress fires per user;
// resolves with { generated, total } when done.
export function bulkGenerateUserAvatars(slug, { overwrite = false, provider, model, quality, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`/api/orgs/${slug}/users/avatars/bulk-generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overwrite, provider, model, quality }),
    }).then(async (res) => {
      if (!(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
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
            if (data.type === 'done') resolve(data);
            else onProgress(data);
          } catch { /* skip */ }
        }
      }
    }).catch(reject);
  });
}

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

// ── Preview videos (Sora / Veo) ──────────────────────────────────────────────

export function getVideoProviders() {
  return fetch('/api/orgs/video-providers')
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

export function listOrgVideos(slug) {
  return fetch(`/api/orgs/${slug}/videos`)
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

export function deleteOrgVideo(slug, id) {
  return fetch(`/api/orgs/${slug}/video/${id}`, { method: 'DELETE' })
    .then((r) => r.json())
    .then((j) => { if (!j.success) throw new Error(j.error); return j.data; });
}

// Build the prompt(s) from org context without generating a (paid) video.
// Resolves with an array of prompt strings.
export function previewOrgVideoPrompt(slug, opts) {
  return new Promise((resolve, reject) => {
    fetch(`/api/orgs/${slug}/video/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...opts, dryRun: true }),
    }).then(async (res) => {
      if (!(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
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
            if (data.type === 'done') resolve(data.prompts || []);
            else if (data.type === 'error') reject(new Error(data.error));
          } catch { /* skip */ }
        }
      }
    }).catch(reject);
  });
}

// Streams generation over SSE. onEvent(data) fires for every frame
// ({ type: 'status'|'prompt'|'progress'|'done'|'error', ... }); resolves with
// the saved video entry, rejects on error.
export function generateOrgVideo(slug, opts, { onEvent = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`/api/orgs/${slug}/video/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }).then(async (res) => {
      if (!(res.headers.get('Content-Type') || '').includes('text/event-stream')) {
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
            onEvent(data);
            if (data.type === 'done') resolve(data.video);
            else if (data.type === 'error') reject(new Error(data.error));
          } catch { /* skip malformed frame */ }
        }
      }
    }).catch(reject);
  });
}
