const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const ALLOWED_MEDIA_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

const MAX_IMAGE_SIZE_MB = 10;
const MAX_VIDEO_SIZE_MB = 200;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

export function isVideoFile(file) {
  if (!file) return false;
  if (file.type && ALLOWED_VIDEO_TYPES.includes(file.type)) return true;
  const name = (file.filename || file.name || "").toLowerCase();
  return name.endsWith(".mp4") || name.endsWith(".mov");
}

export function validateImageFile(file) {
  if (!file) return "No file selected";

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return `Invalid file type. Allowed: JPG, PNG, WebP`;
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return `File exceeds ${MAX_IMAGE_SIZE_MB}MB limit`;
  }

  return null;
}

export function validateMediaFile(file) {
  if (!file) return "No file selected";

  if (!ALLOWED_MEDIA_TYPES.includes(file.type)) {
    return `Invalid file type. Allowed: JPG, PNG, WebP, MP4, MOV`;
  }

  const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
  const maxBytes = isVideo ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
  const maxLabel = isVideo ? MAX_VIDEO_SIZE_MB : MAX_IMAGE_SIZE_MB;

  if (file.size > maxBytes) {
    return `File exceeds ${maxLabel}MB limit`;
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
