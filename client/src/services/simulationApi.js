const BASE = "/api/simulation";

async function postJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

/** Sign in and list the organizations the user belongs to. */
export function connect(credentials) {
  return postJson("/connect", credentials);
}

/** Branches (id + name) inside one organization. */
export function fetchBranches(credentials, organizationId) {
  return postJson("/branches", { ...credentials, organizationId });
}

/** Per-person breakdown of what the run will do. Writes nothing. */
export function previewSimulation(credentials, { organizationId, branchId, leads }) {
  return postJson("/preview", { ...credentials, organizationId, branchId, leads });
}

/**
 * Run the simulation, streaming steps back as they happen.
 * `onStep` fires per server step; resolves with the final result payload.
 */
export async function runSimulation(payload, onStep) {
  const res = await fetch(`${BASE}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.body) throw new Error("Streaming not supported by this browser");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith("data:")) continue;
      let parsed;
      try {
        parsed = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (parsed.type === "step") onStep(parsed.step);
      if (parsed.type === "done") final = parsed.result;
    }
  }

  if (!final) throw new Error("Stream ended without a result");
  if (!final.success) throw new Error(final.error || "Simulation failed");
  return final;
}
