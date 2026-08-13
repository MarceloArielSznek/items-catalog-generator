// Legacy item generator UI (Price Book / item compose). Shown in dev, hidden in
// prod builds so only the org generator ships. Set VITE_ENABLE_ITEM_GENERATOR=true
// (or =false) in server/.env to override the default.
export const ITEM_GENERATOR_ENABLED =
  import.meta.env.VITE_ENABLE_ITEM_GENERATOR === "true" ||
  (import.meta.env.VITE_ENABLE_ITEM_GENERATOR !== "false" && import.meta.env.DEV);
