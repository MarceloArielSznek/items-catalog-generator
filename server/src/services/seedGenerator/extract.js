import OpenAI from 'openai';
import { EXTRACT_SYSTEM_PROMPT, buildExtractUserPrompt } from './prompts/extract.js';

export async function extractWebsiteData(pages, openai) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: buildExtractUserPrompt(pages) },
    ],
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from extract LLM');

  const parsed = JSON.parse(content);

  return {
    companyName: parsed.companyName || '',
    phone: parsed.phone || '',
    contractorLicense: parsed.contractorLicense || '',
    about: parsed.about || '',
    services: parsed.services || [],
    branches: parsed.branches || [],
    financingTerms: parsed.financingTerms || [
      { name: '0% for 12 Months', termMonths: 12, interestRate: 0, mostPopular: true },
    ],
    industry: parsed.industry || 'general',
    region: parsed.region || '',
    warnings: [],
  };
}
