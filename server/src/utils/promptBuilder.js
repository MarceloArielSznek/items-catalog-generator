export function buildCompositionPrompt({ itemName, instruction }) {
  const parts = [
    "Create a professional catalog-style product image.",
    "The background scene must remain exactly as provided.",
    "The product item must be placed naturally into the scene with realistic scale, perspective, and a subtle contact shadow.",
    "Maintain realistic, bright, professional lighting.",
    "Do NOT redesign the product.",
    "Do NOT add people, fake text, logos, watermarks, dramatic effects, or unrelated objects.",
    "Do NOT add any company logo or branding — the logo will be added separately.",
    "The result should look like a polished contractor catalog visual suitable for proposals.",
  ];

  if (itemName) {
    parts.push(`The product being placed is: ${itemName}.`);
  }

  if (instruction) {
    parts.push(`Additional instruction: ${instruction}`);
  }

  return parts.join("\n");
}
