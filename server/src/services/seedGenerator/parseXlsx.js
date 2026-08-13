import * as XLSX from 'xlsx';

const UNIT_MAP = {
  'sq. ft.': 'Sq. Ft.',
  'sq.ft.': 'Sq. Ft.',
  'linear ft.': 'Linear Feet',
  'linear feet': 'Linear Feet',
  'each': 'Each',
  'hour': 'Hours',
  'hours': 'Hours',
  'big sq.': 'Big Sq.',
  'big sq': 'Big Sq.',
  'dollars': 'Dollars',
  'day': 'Each',
  'job': 'Each',
  'roll': 'Each',
  'bag': 'Each',
  'ton': 'Each',
};

function mapUnit(raw) {
  return UNIT_MAP[String(raw).toLowerCase().trim()] ?? 'Each';
}

function mapAppliesTo(raw) {
  if (String(raw).toLowerCase().trim().includes('material')) return 'Material Cost';
  return 'Labor Cost';
}

function readSheet(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function splitSemicolon(val) {
  if (!val) return [];
  return String(val).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

function num(val) {
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function bool(val) {
  const s = String(val).toLowerCase().trim();
  return s === 'yes' || s === 'true' || s === '1';
}

export function parsePricebookXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const warnings = [];

  // ── Factors ─────────────────────────────────────────────────────────────────
  const factors = readSheet(wb, 'Factors')
    .filter((r) => r['Factor Name *'])
    .map((r) => ({
      name: String(r['Factor Name *']).trim(),
      factor: num(r['Multiplier *']) || 1,
      appliesTo: mapAppliesTo(String(r['Applies To *'] || 'Labor Cost')),
      alwaysEnabled: bool(r['Always Enabled?']),
    }));

  if (!factors.some((f) => f.name.toLowerCase() === 'standard')) {
    factors.unshift({ name: 'Standard', factor: 1.0, appliesTo: 'Labor Cost', alwaysEnabled: true });
  }

  // ── Additional Costs ─────────────────────────────────────────────────────────
  const additionalCosts = readSheet(wb, 'Additional Costs')
    .filter((r) => r['Additional Cost Name *'])
    .map((r) => ({
      name: String(r['Additional Cost Name *']).trim(),
      cost: num(r['Cost *']),
      appliesTo: mapAppliesTo(String(r['Applies To *'] || 'Material Cost')),
    }));

  // ── Work Areas ───────────────────────────────────────────────────────────────
  const workAreaDefs = readSheet(wb, 'Work Areas')
    .filter((r) => r['Work Area Name'])
    .map((r) => ({
      name: String(r['Work Area Name']).trim(),
      factorNames: splitSemicolon(r['Factors']),
    }));

  // ── Item Categories ──────────────────────────────────────────────────────────
  const categoryWorkAreas = new Map();
  readSheet(wb, 'Item Categories')
    .filter((r) => r['Category Name *'])
    .forEach((r) => {
      const catName = String(r['Category Name *']).trim();
      categoryWorkAreas.set(catName, splitSemicolon(r['Work Areas']));
    });

  const workAreaCategories = new Map();
  for (const [cat, was] of categoryWorkAreas.entries()) {
    for (const wa of was) {
      if (!workAreaCategories.has(wa)) workAreaCategories.set(wa, []);
      workAreaCategories.get(wa).push(cat);
    }
  }

  const workAreas = workAreaDefs.map((wa) => ({
    name: wa.name,
    categories: workAreaCategories.get(wa.name) ?? [],
    factorNames: wa.factorNames,
  }));

  // ── Items ────────────────────────────────────────────────────────────────────
  const categoryItems = new Map();
  for (const catName of categoryWorkAreas.keys()) categoryItems.set(catName, []);

  const subcontractedItems = [];

  for (const row of readSheet(wb, 'Items')) {
    const name = String(row['Item Name *'] || '').trim();
    if (!name) continue;

    const categories = splitSemicolon(row['Item Categories Included (one or many; semicolon-separated) *']);
    const unit = mapUnit(String(row['Unit Type *'] || 'Each'));
    const materialCost = num(row['Material Cost *']);
    const laborHours = num(row['Labor Hours *']);
    const itemInfo = String(row['Description / Scope'] || '').replace(/\n/g, ' ').trim().slice(0, 200) || name;
    const notes = String(row['Customer Description'] || row['Notes'] || '').trim();
    const factorNames = splitSemicolon(row['Factors']);
    const additionalCostNames = splitSemicolon(row['Additional Costs']);
    const requiresInfo = bool(row['Requires Info?']);
    const multiplierOverride = row['Multiplier Override'] === '' ? null : num(row['Multiplier Override']);

    for (const cat of categories) {
      if (cat && !categoryWorkAreas.has(cat)) {
        warnings.push(`Item "${name}" references unknown category "${cat}"`);
      }
    }

    const primaryCat = categories[0];
    if (!primaryCat || primaryCat.toLowerCase().includes('subcontract')) {
      subcontractedItems.push({ name, itemInfo, notes, unit, materialCost, requiresInfo, factorNames, additionalCostNames, multiplierOverride });
      continue;
    }

    if (!categoryItems.has(primaryCat)) categoryItems.set(primaryCat, []);
    categoryItems.get(primaryCat).push({ name, itemInfo, notes, unit, materialCost, laborHours, requiresInfo, factorNames, additionalCostNames, multiplierOverride });
  }

  // ── Assemble categories ──────────────────────────────────────────────────────
  const categories = [];
  for (const [catName, items] of categoryItems.entries()) {
    if (items.length === 0) {
      warnings.push(`Category "${catName}" has no items`);
      continue;
    }
    categories.push({ name: catName, title: catName, factorNames: [], items });
  }

  if (factors.length === 0) warnings.push('No factors found in Factors sheet');
  if (categories.length === 0) warnings.push('No categories with items found');
  if (workAreas.length === 0) warnings.push('No work areas found');

  return {
    pricebook: {
      workAreas,
      categories,
      factors,
      additionalCosts,
      subcontractedItems,
      vehicleTemplates: [],
      equipmentTypes: [],
    },
    warnings,
  };
}
