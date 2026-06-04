import { buildPricebookSystemPrompt, buildPricebookUserPrompt } from './prompts/pricebook.js';

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
    model: 'o3',
    max_completion_tokens: 100000,
    messages: [
      {
        role: 'system',
        content: buildPricebookSystemPrompt(
          params.industry,
          params.region,
          params.companyName,
          params.companyAbout,
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
        }),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from pricebook LLM');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON object found in pricebook response');
  const parsed = JSON.parse(jsonMatch[0]);

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
