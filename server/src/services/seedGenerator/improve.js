import { buildItemDescriptionsPrompt, buildProposalContentPrompt, buildUserIdentitiesPrompt } from './prompts/improve.js';

const PROPOSAL_KEYS = [
  'about',
  'disclaimer',
  'paymentTerms',
  'insuranceClaims',
  'termsAndConditions',
  'defaultProposalEmailSubject',
  'defaultProposalEmailBody',
];

function parseJsonObject(content, label) {
  if (!content) throw new Error(`Empty response from ${label} LLM`);
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object found in ${label} response`);
  return JSON.parse(match[0]);
}

// Flatten the org's catalog into a list of items tagged with their category,
// optionally filtered to a single category.
function collectItems(org, categoryName) {
  const items = [];
  for (const category of org.resources?.categories || []) {
    if (categoryName && category.name !== categoryName) continue;
    for (const item of category.items || []) {
      items.push({
        category: category.name,
        name: item.name,
        unit: item.unit || '',
        current: item.itemInfo || item.notes || '',
      });
    }
  }
  return items;
}

/**
 * Rewrite the customer-facing `notes` for every item in the org (or one
 * category). Chunked per category so each LLM call stays small and reliable.
 * Returns a map of `item name -> new notes`.
 */
export async function improveItemDescriptions(org, openai, { categoryName } = {}) {
  const items = collectItems(org, categoryName);
  if (items.length === 0) return {};

  // Group by category so each request is bounded.
  const byCategory = new Map();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  const result = {};
  for (const [, group] of byCategory) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: buildItemDescriptionsPrompt(org, group) }],
    });
    const parsed = parseJsonObject(response.choices[0]?.message?.content, 'item descriptions');
    for (const [name, notes] of Object.entries(parsed)) {
      if (typeof notes === 'string' && notes.trim()) result[name] = notes.trim();
    }
  }
  return result;
}

/**
 * Cheap gender guess from a first name (gpt-4o-mini, ~fractions of a cent) so
 * generated avatars match the person's name. Returns 'male' | 'female' | ''.
 */
export async function inferGenderFromName(firstName, openai) {
  const name = (firstName || '').trim();
  if (!name) return '';
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `What is the most likely gender presentation for a person whose first name is "${name}"? Reply ONLY with JSON {"gender":"male"|"female"|"unknown"}.`,
      }],
    });
    const parsed = JSON.parse(r.choices[0]?.message?.content || '{}');
    return parsed.gender === 'male' || parsed.gender === 'female' ? parsed.gender : '';
  } catch {
    return '';
  }
}

/**
 * Generate realistic { name, about } identities for the org's users (all, or a
 * subset by email). Returns a map of `email -> { name, about }`.
 */
export async function generateUserIdentities(org, openai, { emails } = {}) {
  const wanted = emails && emails.length ? new Set(emails) : null;
  const users = (org.users || []).filter((u) => !wanted || wanted.has(u.email));
  if (users.length === 0) return {};

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.8,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: buildUserIdentitiesPrompt(org, users) }],
  });
  const parsed = parseJsonObject(response.choices[0]?.message?.content, 'user identities');

  const out = {};
  for (const [email, val] of Object.entries(parsed)) {
    if (!val || typeof val !== 'object') continue;
    const entry = {};
    if (typeof val.name === 'string' && val.name.trim()) entry.name = val.name.trim();
    if (typeof val.about === 'string' && val.about.trim()) entry.about = val.about.trim();
    if (Object.keys(entry).length) out[email] = entry;
  }
  return out;
}

/**
 * Regenerate the full proposalContent block for an org. Returns an object with
 * the PROPOSAL_KEYS fields (only non-empty string values are kept).
 */
export async function generateProposalContent(org, openai) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: buildProposalContentPrompt(org) }],
  });
  const parsed = parseJsonObject(response.choices[0]?.message?.content, 'proposal content');
  const out = {};
  for (const key of PROPOSAL_KEYS) {
    const value = parsed[key];
    if (typeof value === 'string' && value.trim()) out[key] = value.trim();
  }
  return out;
}
