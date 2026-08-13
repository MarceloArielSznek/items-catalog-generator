// Prompts for the post-hoc "improve with AI" actions on an existing org:
//   - buildItemDescriptionsPrompt: rewrite item `notes` (the customer-facing
//     description that deploys into Menaia's single `itemInfo` field).
//   - buildProposalContentPrompt: regenerate the full proposalContent block.
// Both mirror the rules in prompts/pricebook.js so initial generation and later
// improvement stay consistent.

function orgContext(org) {
  const industry = org.industry || 'home services';
  const region = org.region || 'the United States';
  const name = org.name || 'this contractor';
  return { industry, region, name };
}

export function buildItemDescriptionsPrompt(org, items) {
  const { industry, region, name } = orgContext(org);

  const list = items
    .map((it) => {
      const parts = [
        `- name: ${it.name}`,
        `  category: ${it.category || ''}`,
        `  unit: ${it.unit || ''}`,
      ];
      if (it.current) parts.push(`  current: ${it.current}`);
      return parts.join('\n');
    })
    .join('\n');

  return `You are a proposal copywriter for ${name}, a ${industry} contractor in ${region}.

Rewrite the customer-facing description (the single Item Info field) for each price-book item below. This text appears as the line-item description on the customer's proposal AND is posted to the API, so it must read like the polished proposal of an established, reputable contractor.

RULES for every description:
- Write 3-5 full sentences (~45-90 words).
- Cover, in order: (1) what the service includes / what gets done, (2) the materials, grade, or method used, (3) why it matters to the homeowner (comfort, energy savings, code, moisture/health, longevity).
- Write for a homeowner reading a proposal, not a technician. Warm, confident, specific.
- No marketing fluff, no internal pricing or cost data, no placeholders.
- Stay accurate to the item name, spec, and unit — do not invent unrelated services.

ITEMS:
${list}

Return ONLY a valid JSON object mapping each item's exact name to its new description, no markdown or explanation:
{ "<exact item name>": "<3-5 sentence description>", ... }`;
}

export function buildUserIdentitiesPrompt(org, users) {
  const { industry, region, name } = orgContext(org);

  const list = users
    .map((u) => {
      const parts = [`- email: ${u.email}`, `  role: ${u.role || ''}`];
      if (u.name) parts.push(`  current_name: ${u.name}`);
      if (u.branches?.length) parts.push(`  branches: ${u.branches.join(', ')}`);
      return parts.join('\n');
    })
    .join('\n');

  return `You are creating realistic staff profiles for ${name}, a ${industry} contractor in ${region}.

For each team member below, invent a believable, professional identity:
- name: a realistic full first + last name appropriate for the ${region} market. Make each name distinct from the others.
- about: a warm, credible 1-3 sentence professional bio written in the third person, matching their role (years of experience, specialty, what they handle for customers). No placeholders, no contact info.

TEAM:
${list}

Return ONLY a valid JSON object keyed by each member's exact email, no markdown or explanation:
{ "<email>": { "name": "<full name>", "about": "<1-3 sentence bio>" }, ... }`;
}

export function buildProposalContentPrompt(org) {
  const { industry, region, name } = orgContext(org);

  return `You are preparing the standard proposal content for ${name}, a ${industry} contractor in ${region}. This text appears on every customer proposal, so write it so it reads like the polished proposal of an established, reputable contractor — specific, confident, and legitimate.

PLACEHOLDER RULES (CRITICAL — the proposal system only interpolates these exact tokens; any other token renders as literal text):
- {{ company_name }} — the contractor's company name
- {{ client_first_name }} — the customer's first name
- {{ inspector_name }} — the rep/inspector who prepared the proposal
- {{ inspector_number }} — that rep's phone number
- {{ date }} — the proposal date
Use the tokens EXACTLY as written above, including the spaces inside the braces. NEVER invent other placeholders (no {{companyName}}, no {{proposalLink}}, etc.).

Generate these fields:
- about: a warm, credible 2-paragraph welcome block in the first person plural ("we"). First paragraph: thank the customer for choosing ${name} and convey passion for the work, the team, and the client experience. Second paragraph: set expectations around transparency, process, and timelines. Use the literal company name "${name}" (not a placeholder).
- disclaimer: 1-2 sentences covering price/schedule estimates and site-condition changes. Industry-specific.
- paymentTerms: 2-4 sentences. Cover the deposit required to schedule (realistic % for this industry), how progress/completed-work payments are handled, when the final balance is due (e.g. prior to crew departure on the final day), and how additional/out-of-scope services are billed.
- insuranceClaims: 2-3 sentences on the customer's responsibility when the work is part of an insurance claim, including that the customer remains responsible for full payment if a claim is denied, and the window to pay after denial.
- termsAndConditions: a moderate block of 3-5 short paragraphs (NOT a full legal contract). Cover: (1) client authorization to perform the scope and responsibility for payment, (2) that the scope is limited to what is listed and timelines are good-faith estimates, (3) workmanship warranty availability and that remedies are limited to re-performing the work, (4) that any change to scope requires a written change order, (5) governing law / dispute resolution for ${region} and the customer's 3-business-day right to cancel. Plain English.
- defaultProposalEmailSubject: e.g. "Proposal from {{ company_name }} - {{ date }}".
- defaultProposalEmailBody: a warm, professional 4-6 line email body. Open with "Hi {{ client_first_name }}," thank them for their interest, note the attached quote and contract were prepared from the details they provided, invite questions or adjustments, then close with "Best regards," followed by {{ inspector_name }} and {{ inspector_number }} on their own lines. Do NOT include a proposal link.

Return ONLY a valid JSON object with exactly these keys, no markdown or explanation:
{ "about": "string", "disclaimer": "string", "paymentTerms": "string", "insuranceClaims": "string", "termsAndConditions": "string", "defaultProposalEmailSubject": "string", "defaultProposalEmailBody": "string" }`;
}
