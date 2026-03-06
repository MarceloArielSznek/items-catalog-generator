import multer from "multer";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import env from "../config/env.js";
import { UPLOAD_FIELDS } from "../../../shared/constants/imageRules.js";
import { isAllowedMimeType } from "../utils/fileValidation.js";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, env.UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  if (isAllowedMimeType(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}`), false);
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.MAX_FILE_SIZE_BYTES },
});

export const uploadCatalogFiles = upload.fields([
  { name: UPLOAD_FIELDS.BACKGROUND, maxCount: 1 },
  { name: UPLOAD_FIELDS.ITEM, maxCount: 1 },
  { name: UPLOAD_FIELDS.LOGO, maxCount: 1 },
]);
