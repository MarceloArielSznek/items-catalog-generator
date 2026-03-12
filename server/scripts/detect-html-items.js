/**
 * Detects all Payload items whose description (itemInfo) is stored as HTML
 * rather than Markdown.
 *
 * Run from server directory: npm run script:detect-html-items
 * Or from repo root: npm run script:detect-html-items --prefix server
 * Requires .env with API_BASE_URL (or PAYLOAD_API_URL), API_USER, API_PASSWORD.
 */

import { getAllItems } from "../src/services/payloadService.js";

function looksLikeHtml(str) {
  if (str == null || typeof str !== "string") return false;
  const t = str.trim();
  if (t === "") return false;
  return t.startsWith("<") && (t.includes("</") || t.includes("/>") || />/.test(t));
}

async function main() {
  console.log("Fetching all items from Payload...\n");
  const items = await getAllItems();
  const withHtml = items.filter((item) => {
    const raw = item.itemInfo ?? item.description ?? "";
    return String(raw).trim() !== "" && looksLikeHtml(raw);
  });

  console.log(`Total items: ${items.length}`);
  console.log(`Items with HTML description: ${withHtml.length}\n`);

  if (withHtml.length === 0) {
    console.log("No items with HTML descriptions found.");
    return;
  }

  console.log("ID\tName\tCategory");
  console.log("-".repeat(80));
  for (const item of withHtml) {
    const name = (item.name || "Untitled").slice(0, 50);
    const cat = item._categoryName || item.category?.name || item.category || "—";
    console.log(`${item.id}\t${name}\t${cat}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
