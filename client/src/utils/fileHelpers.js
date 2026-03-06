const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_MB = 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

export function validateImageFile(file) {
  if (!file) return "No file selected";

  if (!ALLOWED_TYPES.includes(file.type)) {
    return `Invalid file type. Allowed: JPG, PNG, WebP`;
  }

  if (file.size > MAX_SIZE_BYTES) {
    return `File exceeds ${MAX_SIZE_MB}MB limit`;
  }

  return null;
}

export function createPreviewUrl(file) {
  if (!file) return null;
  return URL.createObjectURL(file);
}

export function revokePreviewUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
