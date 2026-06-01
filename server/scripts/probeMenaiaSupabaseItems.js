import "../src/config/env.js";
import env from "../src/config/env.js";
import { getMenaiaCookieHeader } from "../src/services/menaiaAuthService.js";

async function main() {
  const cookie = await getMenaiaCookieHeader({ forceRefresh: true });
  const response = await fetch(`${env.PAYLOAD_API_URL}/api/items?limit=1&depth=0`, {
    headers: {
      Accept: "application/json",
      Cookie: cookie,
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.errors?.[0]?.message ?? data?.message ?? data?.error ?? response.statusText;
    throw new Error(`Menaia items probe failed with HTTP ${response.status}: ${message}`);
  }

  console.log("Menaia Supabase items probe succeeded.");
  console.log(`Status: ${response.status}`);
  console.log(`Items returned: ${Array.isArray(data?.docs) ? data.docs.length : "unknown"}`);
  console.log(`Total items: ${data?.totalDocs ?? "unknown"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
