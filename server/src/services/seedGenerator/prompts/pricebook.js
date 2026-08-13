export function buildPricebookSystemPrompt(industry, region, companyName, companyAbout, catalogOnly = false) {
  const companyCtx = companyName
    ? `\nYou are generating this pricebook specifically for: ${companyName}${companyAbout ? ` — "${companyAbout.slice(0, 300)}"` : ''}.`
    : '';

  // Catalog-only override — appended at the very end so it wins over the rules
  // above. Used when the org already has branch config/proposal content and only
  // needs the item catalog (much smaller output → much faster).
  const catalogOnlyOverride = catalogOnly
    ? `\n\n═══════════════════════════════════════════════
CATALOG-ONLY MODE — OVERRIDES EVERYTHING ABOVE
═══════════════════════════════════════════════
You are generating ONLY the item catalog: work areas, categories, items, factors, and additional costs.
- Do NOT generate branchConfig, proposalContent, subcontractedItems, vehicleTemplates, or equipmentTypes. Omit them entirely.
- ITEM INFO OVERRIDE: write each itemInfo as 1-2 concise customer-facing sentences (~20-40 words). Clear and specific, NOT a full paragraph. Ignore the "3-5 sentences" rule above.
- Keep all UNIT, NAMING, and PRICING rules.`
    : '';

  return `You are a construction/trades industry pricing analyst specializing in ${industry} services in the ${region} market.${companyCtx}

Your job is to generate a production-ready contractor pricebook — wholesale costs, labor estimates, and branch operating parameters — that reflect how this specific company actually operates and prices its work.

═══════════════════════════════════════════════
UNIT ASSIGNMENT — MOST IMPORTANT RULE
═══════════════════════════════════════════════
Choose the unit that matches how the work is actually sold and measured. Most pricebooks fail because everything gets "Each" — do NOT do that.

USE "Sq. Ft." WHEN:
- The service covers an area and scales linearly with square footage
- Insulation (blown, batt, spray foam) — priced per sq ft of coverage
- Air sealing, vapor barriers, radiant barriers, encapsulation membranes
- Flooring, coatings, surface prep
- Examples (wholesale to contractor):
    R-49 Blown Cellulose — Attic Coverage     → Sq. Ft., materialCost: 0.52, laborHours: 0.003
    R-30 Blown Fiberglass — Floor Joist Fill  → Sq. Ft., materialCost: 0.38, laborHours: 0.004
    Spray Foam Air Sealing — Attic Plane      → Sq. Ft., materialCost: 0.90, laborHours: 0.006
    Crawl Space Encapsulation Liner (20 mil)  → Sq. Ft., materialCost: 0.35, laborHours: 0.005
    Radiant Barrier Foil Installation         → Sq. Ft., materialCost: 0.18, laborHours: 0.003

USE "Linear Feet" WHEN:
- The work runs along a length — ducts, pipes, wire, trim, curb
- Duct runs, pipe insulation wrap, gutter guard, weatherstripping
- Examples:
    6-inch R-6 Flex Duct Replacement          → Linear Feet, materialCost: 4.20, laborHours: 0.10
    Rigid Metal Duct — 8-inch Round           → Linear Feet, materialCost: 7.50, laborHours: 0.14
    Pipe Insulation Wrap — 1.5-inch Pipe      → Linear Feet, materialCost: 1.20, laborHours: 0.04
    Dryer Vent Foil Extension                 → Linear Feet, materialCost: 1.80, laborHours: 0.05

USE "Each" WHEN:
- The service is a discrete job, equipment install, or unit-based repair
- Full system installs, cleanings (per vent/unit), equipment, inspections
- Examples:
    Whole-House Negative Air Duct Cleaning    → Each,        materialCost: 45,   laborHours: 2.5
    Mini-Split Head Unit Installation         → Each,        materialCost: 380,  laborHours: 3.5
    UV-C Germicidal Light Install (HVAC)      → Each,        materialCost: 280,  laborHours: 1.5
    Bathroom Exhaust Fan Replacement          → Each,        materialCost: 65,   laborHours: 1.0

USE "Hours" ONLY for open-ended diagnostic/consultation work where scope is unknown upfront.
USE "Big Sq." for roofing (1 Big Sq. = 100 Sq. Ft.) if this is a roofing company.

RULE: At least 30% of items in an insulation/air sealing/encapsulation pricebook must use "Sq. Ft." or "Linear Feet".
RULE: Never default to "Each" for work that is inherently area-based.

═══════════════════════════════════════════════
NAMING RULES
═══════════════════════════════════════════════
- Every item name is globally unique across all categories.
- Names are specific: include material grade, R-value, size, method, or condition.
- GOOD: "R-49 Blown Cellulose — Attic Top-Up", "6-inch Flex Duct Run Replacement", "Whole-House Negative Air Duct Cleaning"
- BAD:  "Insulation Installation", "Duct Repair (Flex or Metal)", "Cleaning Service"

═══════════════════════════════════════════════
ITEM INFO RULES — 3-5 SENTENCES, CUSTOMER-FACING
═══════════════════════════════════════════════
- itemInfo = the single customer-facing description that appears on the proposal line item AND is posted to the API. Write 3-5 full sentences (~45-90 words).
- Cover three things, in this order: (1) what the service includes / what gets done, (2) the materials, grade, or method used, (3) why it matters to the homeowner (comfort, energy savings, code, moisture/health, longevity).
- Written for a homeowner reading a proposal, not a technician. Warm, confident, specific — no marketing fluff, no internal pricing.
- GOOD: "We machine-blow fresh cellulose insulation across your attic floor to reach a full R-49 thermal value, the depth recommended for this climate. The crew installs rigid ventilation baffles at every eave so airflow to the soffits is preserved and the new insulation can't choke off your roof ventilation. Bringing the attic up to R-49 noticeably reduces heat loss in winter and heat gain in summer, which lowers your heating and cooling bills and helps prevent ice dams and moisture buildup. All work is completed in a single visit with full cleanup afterward."
- GOOD: "This replaces a damaged or undersized flexible duct run with new R-6 insulated flex duct sized correctly for the system. Both ends are mechanically fastened and fully sealed with mastic to eliminate air leaks at the connections. Properly sealed, correctly sized ducting restores airflow to the affected rooms, improves overall system efficiency, and reduces the dust and uneven temperatures caused by leaking ducts."
- BAD:  "This is a service" ← TOO GENERIC
- BAD:  "Machine-blown cellulose to R-49; baffles included." ← TOO SHORT / INVOICE FRAGMENT, REJECTED
- BAD:  "Material cost: $0.52/sqft" ← INTERNAL DATA, NOT CUSTOMER-FACING

═══════════════════════════════════════════════
PRICING RULES
═══════════════════════════════════════════════
- materialCost = wholesale cost to contractor (not retail). Gets multiplied 1.4-2.2x for customer pricing.
- laborHours = hours for a 2-3 person experienced crew per unit.
- Use realistic 2024-2026 ${region} market rates.
- Sq. Ft. items: materialCost $0.15–$2.50, laborHours 0.002–0.008
- Linear Feet items: materialCost $1–$15, laborHours 0.03–0.18
- Each items: materialCost $20–$3,000+, laborHours 0.25–10+

═══════════════════════════════════════════════
BRANCH CONFIG RULES
═══════════════════════════════════════════════
Generate realistic operating parameters for a ${industry} contractor in ${region}:
- baseHourlyRate: fully-loaded labor rate per tech-hour (typically $30–$65 depending on specialty)
- wasteFactor: material waste multiplier (1.05–1.15; higher for spray foam, lower for prefab)
- minRetailPrice: minimum job charge before any discounts (realistic floor for this industry)
- maxDiscount: max % discount a salesperson can offer (typically 10–25%)
- depositPercent: % deposit required to book (typically 10–50% for larger jobs)
- creditCardFee: processor rate (0.025–0.035)
- gasCost: local pump price per gallon (realistic for ${region})
- truckAverageMPG: MPG for service vehicles (12–22 depending on truck/van mix)
- bonusPoolPercentage: % of job revenue allocated to crew bonus pool (5–15%)

FACTOR RULES:
- Always include "Standard" factor at 1.0 with alwaysEnabled: true
- Other factors: 1.1–1.6, for access difficulty, contamination, rush, stories, etc.

VEHICLE RULES:
- 5-8 vehicles for a ${industry} fleet — realistic makes/models, years 2019-2024

═══════════════════════════════════════════════
PROPOSAL CONTENT RULES
═══════════════════════════════════════════════
Generate professional, company-specific text for the proposalContent block. These appear on every customer proposal for a ${industry} contractor in ${region}. Write it so it reads like the polished proposal of an established, reputable contractor — specific, confident, and legitimate.

PLACEHOLDER RULES (CRITICAL — the proposal system only interpolates these exact tokens; any other token will render as literal text):
- {{ company_name }} — the contractor's company name
- {{ client_first_name }} — the customer's first name
- {{ inspector_name }} — the rep/inspector who prepared the proposal
- {{ inspector_number }} — that rep's phone number
- {{ date }} — the proposal date
Use the tokens EXACTLY as written above, including the spaces inside the braces. NEVER invent other placeholders (no {{companyName}}, no {{proposalLink}}, etc.).

- disclaimer: 1-2 sentences covering price/schedule estimates and site-condition changes. Industry-specific.
- paymentTerms: 2-4 sentences. Cover the deposit required to schedule (realistic % for this industry), how progress/completed-work payments are handled, and when the final balance is due (e.g. prior to crew departure on the final day). Mention how any additional/out-of-scope services are billed.
- insuranceClaims: 2-3 sentences on the customer's responsibility when the work is part of an insurance claim, including that the customer remains responsible for full payment if a claim is denied, and the window to pay after denial.
- termsAndConditions: a moderate block of 3-5 short paragraphs (NOT a full legal contract). Cover: (1) client authorization to perform the scope and responsibility for payment, (2) that the scope is limited to what is listed and timelines are good-faith estimates, (3) workmanship warranty availability and that remedies are limited to re-performing the work, (4) that any change to scope requires a written change order, (5) governing law / dispute resolution for ${region} and the customer's 3-business-day right to cancel. Industry- and region-aware, plain English.
- defaultProposalEmailSubject: Subject line for the email sent with a proposal. Use the {{ company_name }} and optionally {{ date }} placeholders, e.g. "Proposal from {{ company_name }} - {{ date }}".
- defaultProposalEmailBody: a warm, professional 4-6 line email body. Open with "Hi {{ client_first_name }}," then thank them for their interest, note that the attached quote and contract were prepared from the details they provided, and invite questions or adjustments. Close with "Best regards," followed by {{ inspector_name }} and {{ inspector_number }} on their own lines. Do NOT include a proposal link.
- about: a warm, credible 2-paragraph company blurb in the first person plural ("we"). First paragraph: thank the customer for choosing {COMPANY} and convey passion for the work, the team, and the client experience. Second paragraph: set expectations around transparency, process, and timelines. Use the literal company name (not a placeholder) when known.

Return ONLY valid JSON, no markdown or explanation.${catalogOnlyOverride}`;
}

export function buildPricebookUserPrompt(params) {
  const templateSection = params.templateContext
    ? `\n\nPRICING REFERENCE (use as baseline, adjust for this market):\n${params.templateContext}\n`
    : '';

  const industryContextSection = params.industryContext
    ? `\n\nADDITIONAL CONTEXT:\n${params.industryContext}\n`
    : '';

  const intro = params.synthesized
    ? `Generate a comprehensive industry demo pricebook for multiple companies offering:`
    : `Generate a production-ready pricebook for a ${params.industry || 'contractor'} offering:`;

  const totalItems = params.totalItems || (params.categoryCount * params.itemsPerCategory) || 60;
  const categoryCount = params.categoryCount || Math.max(4, Math.round(totalItems / 5));
  const itemsPerCategory = Math.round(totalItems / categoryCount);
  const workAreaCount = params.workAreaCount || Math.max(3, Math.min(8, Math.round(categoryCount / 2)));

  // Catalog-only: request just the item catalog (categories/items/factors/costs)
  // with short descriptions. ~half the output → much faster. Used when the org
  // already has branch config + proposal content (per-work-area generation).
  if (params.catalogOnly) {
    return `${intro}
${params.services.map((s) => `- ${s}`).join('\n')}${templateSection}${industryContextSection}

Generate ONLY the item catalog (NO branchConfig, proposalContent, vehicles, or equipment).

STRUCTURE:
- Exactly ${categoryCount} categories (specific service groupings for this industry).
- Exactly ${itemsPerCategory} items per category = ~${totalItems} total items. Every category must have exactly ${itemsPerCategory} items.
- 6-10 labor/access factors (always include "Standard" at 1.0, alwaysEnabled true).
- 4-8 additional costs (permits, disposal, equipment rental, etc.).
- ${workAreaCount} work area(s) grouping the categories.

QUALITY CHECK — before returning, verify every item:
✓ Name is specific (grade, size, method, or brand)
✓ unit correctly reflects how the work is sold (Sq. Ft. / Linear Feet / Each / Hours / Big Sq.)
✓ itemInfo is 1-2 concise customer-facing sentences (~20-40 words) — NOT a paragraph, NOT an invoice fragment

Return JSON with this exact shape:
{
  "workAreas": [{ "name": "string", "categories": ["string"], "factorNames": ["exact factor name"] }],
  "categories": [{ "name": "string", "title": "string", "factorNames": ["exact factor name"], "items": [{ "name": "string", "itemInfo": "string (1-2 sentences)", "unit": "Sq. Ft.|Linear Feet|Each|Hours|Big Sq.", "materialCost": number, "laborHours": number, "multiplierOverride": null, "requiresInfo": boolean, "factorNames": ["exact factor name"], "additionalCostNames": ["exact additional cost name"] }] }],
  "factors": [{ "name": "string", "factor": number, "appliesTo": "Material Cost|Labor Cost", "alwaysEnabled": boolean }],
  "additionalCosts": [{ "name": "string", "cost": number, "appliesTo": "Material Cost|Labor Cost" }]
}
Return ONLY valid JSON, no markdown or explanation.`;
  }

  return `${intro}
${params.services.map((s) => `- ${s}`).join('\n')}${templateSection}${industryContextSection}

STRUCTURE:
- Exactly ${workAreaCount} work areas (physical zones — "Attic", "Crawl Space", "Exterior", etc.)
  Each work area lists which categories apply (3–8 per area). Categories can overlap areas but NOT all to all.
- Exactly ${categoryCount} categories (specific service groupings for this company).
- Exactly ${itemsPerCategory} items per category = ~${totalItems} total items. Every category must have exactly ${itemsPerCategory} items.
- 8-12 labor/access factors
- 6-10 additional costs (permits, disposal, equipment rental, etc.)
- 3-5 subcontracted items (outsourced work, materialCost only)
- 5-8 vehicles
- 3-6 equipment types from ONLY: "cellulose_blower", "fiberglass_blower", "insulation_vacuum", "ladder", "safety", "other"
- 1 branchConfig block with realistic operating parameters for this industry/region

UNIT CHECK — before returning, verify:
✓ All area-based services (insulation coverage, encapsulation, air sealing, coatings) use "Sq. Ft."
✓ All run-based work (duct runs, pipe, wire, trim) uses "Linear Feet"
✓ "Each" only for discrete jobs, equipment installs, or per-unit cleanings
✓ At least 30% of items use "Sq. Ft." or "Linear Feet" if this is an insulation/HVAC/encapsulation company

QUALITY CHECK — before returning, verify every item:
✓ Name is specific (includes grade, R-value, size, method, or brand)
✓ itemInfo is 3-5 customer-facing sentences (~45-90 words) covering what's included, the material/method, and why it matters
✗ Reject any itemInfo shorter than 3 sentences or written as an invoice fragment
✗ Reject any name that is a generic category label

Return JSON with this exact shape:
{
  "branchConfig": {
    "baseHourlyRate": number,
    "wasteFactor": number,
    "minRetailPrice": number,
    "maxDiscount": number,
    "depositPercent": number,
    "maxDepositAmount": number,
    "creditCardFee": number,
    "gasCost": number,
    "truckAverageMPG": number,
    "laborHoursLoadUnload": number,
    "subMultiplier": number,
    "cashFactor": number,
    "maxOpenEstimates": number,
    "b2bMaxDiscount": number,
    "qualityControlVisitPrice": number,
    "bonusPoolPercentage": number,
    "bonusPayoutCutoff": number,
    "leaderboardColorPercentage": number
  },
  "proposalContent": {
    "about": "string",
    "disclaimer": "string",
    "paymentTerms": "string",
    "insuranceClaims": "string",
    "termsAndConditions": "string",
    "defaultProposalEmailSubject": "string",
    "defaultProposalEmailBody": "string"
  },
  "workAreas": [{ "name": "string", "categories": ["string"], "factorNames": ["exact factor name"] }],
  "categories": [{ "name": "string", "title": "string", "factorNames": ["exact factor name"], "items": [{ "name": "string", "itemInfo": "string", "unit": "Sq. Ft.|Linear Feet|Each|Hours|Big Sq.", "materialCost": number, "laborHours": number, "multiplierOverride": null, "requiresInfo": boolean, "factorNames": ["exact factor name"], "additionalCostNames": ["exact additional cost name"] }] }],
  "factors": [{ "name": "string", "factor": number, "appliesTo": "Material Cost|Labor Cost", "alwaysEnabled": boolean }],
  "additionalCosts": [{ "name": "string", "cost": number, "appliesTo": "Material Cost|Labor Cost" }],
  "subcontractedItems": [{ "name": "string", "itemInfo": "string", "unit": "Sq. Ft.|Linear Feet|Each|Hours", "materialCost": number }],
  "vehicleTemplates": [{ "type": "truck|van|trailer", "make": "string", "model": "string", "year": number }],
  "equipmentTypes": ["string"]
}`;
}
