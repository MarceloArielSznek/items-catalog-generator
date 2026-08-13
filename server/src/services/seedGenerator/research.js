import { buildPricebookSystemPrompt, buildPricebookUserPrompt } from './prompts/pricebook.js';

// Pricebook generation model. Defaults to gpt-4o — a fast, non-reasoning model
// that's plenty for demo catalogs (~5-10s/call vs ~60s for o3). Override with
// PRICEBOOK_MODEL (e.g. 'o3' or 'o4-mini') when a catalog needs more "thinking".
const PRICEBOOK_MODEL = process.env.PRICEBOOK_MODEL || 'gpt-4o';
// Reasoning models (o-series) allow a huge completion budget; gpt-4o caps output
// at 16k. One single-industry catalog fits comfortably in 16k.
const IS_REASONING_MODEL = /^o\d/.test(PRICEBOOK_MODEL);
const PRICEBOOK_MAX_TOKENS = IS_REASONING_MODEL ? 100000 : 16000;

const VALID_UNITS = ['Sq. Ft.', 'Big Sq.', 'Dollars', 'Linear Feet', 'Each', 'Hours'];
const VALID_EQUIPMENT_TYPES = [
  'cellulose_blower',
  'fiberglass_blower',
  'insulation_vacuum',
  'ladder',
  'safety',
  'other',
];

const UNIT_ALIASES = {
  'sq ft': 'Sq. Ft.',
  'sqft': 'Sq. Ft.',
  'square feet': 'Sq. Ft.',
  'square foot': 'Sq. Ft.',
  'sf': 'Sq. Ft.',
  'sq. ft': 'Sq. Ft.',
  'lf': 'Linear Feet',
  'lin ft': 'Linear Feet',
  'lineal feet': 'Linear Feet',
  'linear foot': 'Linear Feet',
  'lin. ft.': 'Linear Feet',
  'linear ft': 'Linear Feet',
  'ea': 'Each',
  'unit': 'Each',
  'piece': 'Each',
  'per unit': 'Each',
  'hr': 'Hours',
  'hour': 'Hours',
  'hrs': 'Hours',
  'big sq': 'Big Sq.',
  'big square': 'Big Sq.',
  'square': 'Big Sq.',
  'dollar': 'Dollars',
  'dollars': 'Dollars',
  '$': 'Dollars',
};

function resolveUnit(raw) {
  if (VALID_UNITS.includes(raw)) return raw;
  const normalized = (raw || '').toLowerCase().trim();
  return UNIT_ALIASES[normalized] ?? 'Each';
}

function normalizeEquipmentTypes(pricebook) {
  pricebook.equipmentTypes = pricebook.equipmentTypes.map((t) => {
    if (VALID_EQUIPMENT_TYPES.includes(t)) return t;
    const lower = t.toLowerCase().replace(/[\s-]+/g, '_');
    if (VALID_EQUIPMENT_TYPES.includes(lower)) return lower;
    return 'other';
  });
  const unique = [...new Set(pricebook.equipmentTypes)];
  if (!unique.includes('other') && unique.length < VALID_EQUIPMENT_TYPES.length) {
    unique.push('other');
  }
  pricebook.equipmentTypes = unique;
}

function normalizeUnits(pricebook) {
  for (const category of pricebook.categories) {
    for (const item of category.items) {
      item.unit = resolveUnit(item.unit);
    }
  }
  for (const item of pricebook.subcontractedItems) {
    item.unit = resolveUnit(item.unit);
  }
}

function deduplicateItemNames(pricebook) {
  const seen = new Set();

  for (const category of pricebook.categories) {
    for (const item of category.items) {
      let name = item.name;
      let attempt = 1;
      while (seen.has(name.toLowerCase())) {
        attempt++;
        name = `${item.name} (${category.name.split(' - ')[0]} #${attempt})`;
      }
      item.name = name;
      seen.add(name.toLowerCase());
    }
  }

  for (const item of pricebook.subcontractedItems) {
    let name = item.name;
    let attempt = 1;
    while (seen.has(name.toLowerCase())) {
      attempt++;
      name = `${item.name} - Sub #${attempt}`;
    }
    item.name = name;
    seen.add(name.toLowerCase());
  }
}

export async function generatePricebook(params, openai) {
  // Compute distribution from totalItems if provided
  const totalItems = params.totalItems || (params.categoryCount * params.itemsPerCategory) || 60;
  const categoryCount = params.categoryCount || Math.max(4, Math.round(totalItems / 5));
  const itemsPerCategory = Math.round(totalItems / categoryCount);
  const workAreaCount = params.workAreaCount || Math.max(3, Math.min(8, Math.round(categoryCount / 2)));

  const response = await openai.chat.completions.create({
    model: PRICEBOOK_MODEL,
    max_completion_tokens: PRICEBOOK_MAX_TOKENS,
    // Force a pure JSON object so the model can't prepend prose/markdown (the
    // usual cause of "No JSON object found"). Requires the word "json" in the
    // prompt — present in buildPricebookUserPrompt ("Return JSON with this shape").
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: buildPricebookSystemPrompt(
          params.industry,
          params.region,
          params.companyName,
          params.companyAbout,
          params.catalogOnly,
        ),
      },
      {
        role: 'user',
        content: buildPricebookUserPrompt({
          services: params.services,
          workAreaCount,
          categoryCount,
          itemsPerCategory,
          totalItems,
          industryContext: params.industryContext,
          templateContext: params.templateContext,
          synthesized: params.synthesized,
          catalogOnly: params.catalogOnly,
        }),
      },
    ],
  });

  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  const finish = choice?.finish_reason;
  // finish_reason 'length' means the model ran out of completion budget mid-answer
  // (reasoning + output > max_completion_tokens) — surface it clearly so it's not
  // mistaken for a parse bug.
  if (!content) {
    throw new Error(`Empty response from pricebook LLM (finish_reason=${finish || 'unknown'})`);
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Fallback for any stray wrapping; if even this fails, include diagnostics.
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`No JSON object found in pricebook response (finish_reason=${finish || 'unknown'}, preview="${content.slice(0, 200)}")`);
    }
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (err) {
      throw new Error(`Pricebook JSON parse failed (finish_reason=${finish || 'unknown'}): ${err.message}`);
    }
  }

  const result = {
    branchConfig: parsed.branchConfig || null,
    proposalContent: parsed.proposalContent || null,
    workAreas: parsed.workAreas || [],
    categories: parsed.categories || [],
    factors: parsed.factors || [],
    additionalCosts: parsed.additionalCosts || [],
    vehicleTemplates: parsed.vehicleTemplates || [],
    equipmentTypes: parsed.equipmentTypes || [],
    subcontractedItems: parsed.subcontractedItems || [],
  };

  deduplicateItemNames(result);
  normalizeUnits(result);
  normalizeEquipmentTypes(result);

  return result;
}
