export const EXTRACT_SYSTEM_PROMPT = `You are a data extraction specialist. Given raw text content from a contractor/service company website, extract structured information.

Return a JSON object with these fields:
- companyName: string (official company name)
- phone: string (primary phone number, formatted as XXX-XXX-XXXX)
- contractorLicense: string (license number with state prefix if found, e.g. "CA Lic. #1034380 (C-2)")
- about: string (1-3 sentence company description using facts from the site)
- services: string[] (list of all services/offerings mentioned)
- branches: array of { name: string, address: string } (office locations found)
- financingTerms: array of { name: string, termMonths: number, interestRate: number, mostPopular: boolean }
- industry: string (e.g. "insulation", "roofing", "HVAC", "plumbing")
- region: string (e.g. "Southern California", "Greater Austin TX")

Rules:
- If a field cannot be determined, use reasonable defaults or empty arrays
- For phone, use the first/main number found
- For branches: Look carefully for a /locations page, "Our Locations", "Contact Your Local Branch", or footer addresses. Each named location with a street address is a separate branch. Common patterns:
  * A dedicated locations page listing multiple offices (e.g. "San Diego", "Orange County", "Seattle")
  * Footer sections listing office addresses per region
  * "Contact" pages with multiple office addresses
  If two branches share the same street address, still list them as separate branches (they may serve different regions).
  Service areas without a physical address are NOT branches.
- For services, be comprehensive — include sub-services and specialties
- For industry, pick the single best descriptor
- For financingTerms, if none found return a sensible default: [{ name: "0% for 12 Months", termMonths: 12, interestRate: 0, mostPopular: true }]

Return ONLY valid JSON, no markdown fences or explanation.`;

export function buildExtractUserPrompt(pages) {
  const content = pages
    .slice(0, 14)
    .map((p) => {
      let section = `--- PAGE: ${p.url} ---\n${p.text.slice(0, 1500)}`;

      // Include JSON-LD structured data when present — often contains name, address, phone, services
      if (p.schemas?.length) {
        const schemaText = p.schemas
          .map((s) => JSON.stringify(s))
          .join('\n')
          .slice(0, 1200);
        section += `\n\n[JSON-LD structured data]:\n${schemaText}`;
      }

      // Include meta tags when present
      if (p.meta && Object.keys(p.meta).length) {
        const metaText = Object.entries(p.meta)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');
        section += `\n\n[Meta tags]:\n${metaText}`;
      }

      return section;
    })
    .join('\n\n');

  return `Extract structured company information from these website pages:\n\n${content}`;
}
