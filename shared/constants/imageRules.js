export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

export const UPLOAD_FIELDS = {
  BACKGROUND: "background",
  ITEM: "item",
  LOGO: "logo",
};

export const REQUIRED_FIELDS = [
  UPLOAD_FIELDS.BACKGROUND,
  UPLOAD_FIELDS.ITEM,
  UPLOAD_FIELDS.LOGO,
];

export const LOGO_POSITIONS = [
  "top-left",    "top-center",    "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
];

export const DEFAULT_LOGO_POSITION = "bottom-right";

export const GENERATION_MODES = {
  QUICK:    "quick",
  STANDARD: "standard",
  PREMIUM:  "premium",
};

export const DEFAULT_MODE = GENERATION_MODES.QUICK;

export const OUTPUT_FORMATS = {
  "square":    { width: 1080, height: 1080, label: "Square 1:1",       desc: "Instagram, social" },
  "landscape": { width: 1920, height: 1080, label: "Landscape 16:9",   desc: "Presentations, web" },
  "portrait":  { width: 1080, height: 1350, label: "Portrait 4:5",     desc: "Instagram portrait" },
  "story":     { width: 1080, height: 1920, label: "Story 9:16",       desc: "Stories, Reels" },
  "banner":    { width: 1600, height: 800,  label: "Banner 2:1",       desc: "Website headers" },
};

export const DEFAULT_FORMAT = "square";

export const COMPOSITION_DEFAULTS = {
  logoScale: 0.30,
  logoMargin: 40,
  itemScale: 0.45,
  itemVerticalBias: 0.55,
  contactShadowHeight: 0.06,
  contactShadowOpacity: 0.5,
  ambientShadowBlur: 30,
  ambientShadowOpacity: 0.25,
  ambientShadowSpread: 1.15,
  ambientShadowOffsetY: 8,
};
