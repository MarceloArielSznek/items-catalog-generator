import OpenAI from "openai";
import env from "../config/env.js";
import logger from "../utils/logger.js";

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 6000);
}

export async function extractWebsiteContext(websiteUrl) {
  logger.info(`Fetching website context: ${websiteUrl}`);

  let pageText = "";
  try {
    const res = await fetch(websiteUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CatalogBot/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    pageText = stripHtml(html);
  } catch (err) {
    logger.warn(`Could not fetch website ${websiteUrl}: ${err.message}`);
  }

  const prompt = pageText
    ? `Analyze this home services company website and extract key information for generating professional catalog images.

Website content:
${pageText}

Return a JSON object with:
- "companyName": company name (string)
- "industry": primary industry in 3-5 words, e.g. "HVAC and air conditioning" or "attic insulation and air sealing"
- "services": array of 5-8 main services they offer (short strings)
- "visualStyle": 2-3 adjectives describing their brand feel, e.g. "clean professional residential"
- "targetMarket": who they serve, e.g. "residential homeowners in Southern California"

Return ONLY valid JSON, no markdown.`
    : `Generate reasonable defaults for a home services company at ${websiteUrl}.
Return a JSON object with: companyName, industry, services (array), visualStyle, targetMarket.
Return ONLY valid JSON.`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  try {
    const context = JSON.parse(response.choices[0].message.content);
    logger.info(`Website context extracted for ${websiteUrl}`, { industry: context.industry });
    return context;
  } catch {
    logger.warn(`Could not parse website context JSON, using fallback`);
    return {
      companyName: "",
      industry: "home services",
      services: [],
      visualStyle: "clean professional residential",
      targetMarket: "residential homeowners",
    };
  }
}
