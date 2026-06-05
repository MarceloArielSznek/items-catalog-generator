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
