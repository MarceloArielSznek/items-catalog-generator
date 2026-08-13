import * as cheerio from 'cheerio';
import env from '../../config/env.js';
import logger from '../../utils/logger.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HIGH_PRIORITY_RE = /location|branch|office|where-we-serve|service-area|our-team|about/i;
const MEDIUM_PRIORITY_RE = /service|contact|financ|area|career|team|pricing|estimate|quote/i;

// Jina AI Reader — renders a page server-side and returns its HTML, bypassing
// simple anti-bot walls (e.g. Cloudflare 403s) that block a plain fetch.
const JINA_READER_PREFIX = 'https://r.jina.ai/';

async function fetchDirect(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

// `X-Return-Format: html` makes Jina return the rendered HTML (not markdown), so
// the existing cheerio extractors (text, links, JSON-LD) keep working unchanged.
async function fetchViaJina(url) {
  const headers = { 'User-Agent': USER_AGENT, 'X-Return-Format': 'html' };
  if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
  const res = await fetch(`${JINA_READER_PREFIX}${url}`, {
    headers,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Jina reader failed for ${url}: ${res.status}`);
  return res.text();
}

// Try a direct fetch first; if it fails (bot wall / 403 / timeout), fall back to
// Jina Reader so anti-bot-protected sites are still crawlable.
async function fetchPage(url) {
  try {
    return await fetchDirect(url);
  } catch (err) {
    logger.warn(`[crawl] direct fetch failed for ${url} (${err.message}); retrying via Jina Reader`);
    return await fetchViaJina(url);
  }
}

function extractLinks(html, baseUrl) {
  const $ = cheerio.load(html);
  const links = new Set();
  const base = new URL(baseUrl);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const resolved = new URL(href, base);
      if (resolved.hostname === base.hostname && !resolved.hash) {
        resolved.search = '';
        links.add(resolved.toString());
      }
    } catch {
      // skip invalid URLs
    }
  });

  return [...links];
}

function extractTextContent(html, includeFooter = false) {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe').remove();
  if (!includeFooter) {
    $('nav, header').remove();
  }
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  return text.slice(0, 8000);
}

// Extract JSON-LD schemas and meta tags for richer structured context
function extractStructuredData(html) {
  const $ = cheerio.load(html);
  const schemas = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try { schemas.push(JSON.parse($(el).html())); } catch { /* skip malformed */ }
  });

  const meta = {};
  const picks = [
    ['meta[name="description"]', 'description'],
    ['meta[name="keywords"]', 'keywords'],
    ['meta[property="og:title"]', 'ogTitle'],
    ['meta[property="og:description"]', 'ogDescription'],
  ];
  for (const [sel, key] of picks) {
    const val = $(sel).first().attr('content');
    if (val) meta[key] = val;
  }

  return { schemas, meta };
}

function prioritizeUrl(url) {
  if (HIGH_PRIORITY_RE.test(url)) return 0;
  if (MEDIUM_PRIORITY_RE.test(url)) return 1;
  return 2;
}

// Ask GPT-4o-mini which uncrawled links are most valuable to visit next
async function pickAiGuidedUrls(pages, unvisitedLinks, openai) {
  if (!unvisitedLinks.length) return [];

  const summaries = pages
    .slice(0, 4)
    .map((p) => `[${p.url}]:\n${p.text.slice(0, 400)}`)
    .join('\n\n');

  const linkList = unvisitedLinks.slice(0, 50).join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `I'm crawling a contractor/home-services website to extract company data for catalog generation.

Pages already crawled (summaries):
${summaries}

Uncrawled links available:
${linkList}

Pick up to 6 links that would provide the richest additional information about:
- Specific services and what they include
- Service areas and locations
- Pricing or financing options
- Company history, team, or certifications

Return ONLY a raw JSON array of URL strings. Example: ["https://example.com/services", "https://example.com/about"]`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || '[]';
  try {
    const match = content.match(/\[[\s\S]*?\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch {
    return [];
  }
}

export async function crawlWebsite(url, maxPages = 20, openai = null) {
  const visited = new Set();
  const queue = [{ url, priority: -1 }];
  const pages = [];
  const allLinks = new Set();

  // Phase 1: priority-queue Cheerio crawl (leave 6 slots for AI-guided picks if available)
  const phase1Limit = openai ? Math.max(8, maxPages - 6) : maxPages;

  while (queue.length > 0 && pages.length < phase1Limit) {
    queue.sort((a, b) => a.priority - b.priority);
    const { url: currentUrl } = queue.shift();

    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    try {
      const html = await fetchPage(currentUrl);
      const text = extractTextContent(html, currentUrl === url);
      const { schemas, meta } = extractStructuredData(html);
      pages.push({ url: currentUrl, text, schemas, meta });

      const links = extractLinks(html, currentUrl);
      for (const link of links) {
        allLinks.add(link);
        if (!visited.has(link)) {
          queue.push({ url: link, priority: prioritizeUrl(link) });
        }
      }
    } catch {
      // skip pages that fail to load
    }
  }

  // Phase 2: AI-guided supplemental crawl
  if (openai && pages.length > 0) {
    const unvisited = [...allLinks].filter((l) => !visited.has(l));
    try {
      const aiUrls = await pickAiGuidedUrls(pages, unvisited, openai);
      for (const aiUrl of aiUrls) {
        if (visited.has(aiUrl) || pages.length >= maxPages) continue;
        visited.add(aiUrl);
        try {
          const html = await fetchPage(aiUrl);
          const text = extractTextContent(html);
          const { schemas, meta } = extractStructuredData(html);
          pages.push({ url: aiUrl, text, schemas, meta });
        } catch { /* skip */ }
      }
    } catch { /* don't let AI phase failure break the crawl */ }
  }

  return { url, pages };
}
