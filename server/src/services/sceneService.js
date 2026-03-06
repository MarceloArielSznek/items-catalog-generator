import fsp from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import env from "../config/env.js";
import logger from "../utils/logger.js";

function scenePath(id) {
  return path.resolve(env.SCENES_DIR, id);
}

function metaPath(id) {
  return path.join(scenePath(id), "scene.json");
}

function preserveExtension(originalname) {
  return path.extname(originalname).toLowerCase() || ".png";
}

export async function createScene({ name, backgroundFile, logoFile, logoPosition }) {
  const id = uuidv4();
  const dir = scenePath(id);
  await fsp.mkdir(dir, { recursive: true });

  const bgExt = preserveExtension(backgroundFile.originalname);
  const logoExt = preserveExtension(logoFile.originalname);
  const bgFilename = `background${bgExt}`;
  const logoFilename = `logo${logoExt}`;

  await fsp.copyFile(backgroundFile.path, path.join(dir, bgFilename));
  await fsp.copyFile(logoFile.path, path.join(dir, logoFilename));

  const meta = {
    id,
    name: name || "Untitled Scene",
    logoPosition: logoPosition || "bottom-right",
    backgroundFile: bgFilename,
    logoFile: logoFilename,
    createdAt: new Date().toISOString(),
  };

  await fsp.writeFile(metaPath(id), JSON.stringify(meta, null, 2));
  logger.info("Scene created", { id, name: meta.name });

  return meta;
}

export async function listScenes() {
  try {
    const entries = await fsp.readdir(env.SCENES_DIR, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    const scenes = await Promise.all(
      dirs.map(async (d) => {
        try {
          const raw = await fsp.readFile(metaPath(d.name), "utf-8");
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }),
    );

    return scenes.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function getScene(id) {
  try {
    const raw = await fsp.readFile(metaPath(id), "utf-8");
    const meta = JSON.parse(raw);
    const dir = scenePath(id);
    return {
      ...meta,
      backgroundPath: path.join(dir, meta.backgroundFile),
      logoPath: path.join(dir, meta.logoFile),
      backgroundUrl: `/scenes/${id}/${meta.backgroundFile}`,
      logoUrl: `/scenes/${id}/${meta.logoFile}`,
    };
  } catch {
    return null;
  }
}

export async function deleteScene(id) {
  const dir = scenePath(id);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
    logger.info("Scene deleted", { id });
    return true;
  } catch {
    return false;
  }
}
