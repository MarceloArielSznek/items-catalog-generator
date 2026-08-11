const API_BASE = '/api';

export async function crawlWebsite(url) {
  const res = await fetch(`${API_BASE}/seed/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Crawl failed');
  return data.data;
}

// Crawl 1..N company sites and merge into a synthetic demo source with a fake
// identity. 1 URL = company demo, many = industry demo.
export async function crawlDemo(urls, branchCount = 1) {
  const res = await fetch(`${API_BASE}/seed/demo/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, branchCount }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Demo crawl failed');
  return data.data;
}

export async function parseXlsx(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/seed/parse-xlsx`, { method: 'POST', body: form });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Parse failed');
  return data.data;
}

// Ask the AI to draft the optional "Additional Industry Context" hint from the
// company info collected so far. Returns a short editable paragraph.
export async function generateContext(payload) {
  const res = await fetch(`${API_BASE}/seed/generate-context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Context generation failed');
  return data.data.industryContext;
}

// Create a multi-industry org SHELL (fake identity + branch + config + one empty
// work area per industry). Fast; catalogs are generated per work area later.
export async function createMultiIndustryShell({ industries, region, companyName }) {
  const res = await fetch(`${API_BASE}/seed/multi-industry/shell`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ industries, region, companyName }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Shell creation failed');
  return data.data;
}

// Build a synthetic multi-industry demo org (one work area per industry).
// Streams progress over SSE: `onStep(entry)` fires per step; resolves with the
// final result ({ success, slug, industries, region, error }).
export function generateMultiIndustryDemo(options, { onStep = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    fetch(`${API_BASE}/seed/generate-multi-industry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

export async function generateSeed(input, extracted, pricebook = null) {
  const res = await fetch(`${API_BASE}/seed/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, extracted, pricebook }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Generation failed');
  return data.data;
}
