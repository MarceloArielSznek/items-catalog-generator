import fsp from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import env from "../config/env.js";
import logger from "../utils/logger.js";

const LIBRARY_DIR = path.resolve(env.SCENES_DIR, "..", "library");
const ALBUMS_FILE = path.join(LIBRARY_DIR, "albums.json");

async function ensureLibraryDir() {
  await fsp.mkdir(LIBRARY_DIR, { recursive: true });
}

async function readAlbums() {
  try {
    const raw = await fsp.readFile(ALBUMS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeAlbums(albums) {
  await ensureLibraryDir();
  await fsp.writeFile(ALBUMS_FILE, JSON.stringify(albums, null, 2));
}

function albumItemsDir(albumId) {
  return path.join(LIBRARY_DIR, albumId);
}

function albumItemsFile(albumId) {
  return path.join(albumItemsDir(albumId), "items.json");
}

async function readItems(albumId) {
  try {
    const raw = await fsp.readFile(albumItemsFile(albumId), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeItems(albumId, items) {
  const dir = albumItemsDir(albumId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(albumItemsFile(albumId), JSON.stringify(items, null, 2));
}

// ── Albums ──

export async function createAlbum({ name, sceneId = null }) {
  const albums = await readAlbums();
  const album = {
    id: uuidv4(),
    name: name || "Untitled Album",
    sceneId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  albums.push(album);
  await writeAlbums(albums);
  logger.info("Album created", { id: album.id, name: album.name });
  return album;
}

export async function listAlbums() {
  const albums = await readAlbums();
  const enriched = await Promise.all(
    albums.map(async (album) => {
      const items = await readItems(album.id);
      const thumbnail = items.length > 0 ? items[0].imageUrl : null;
      return { ...album, itemCount: items.length, thumbnail };
    }),
  );
  return enriched.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAlbum(id) {
  const albums = await readAlbums();
  return albums.find((a) => a.id === id) || null;
}

export async function updateAlbum(id, updates) {
  const albums = await readAlbums();
  const idx = albums.findIndex((a) => a.id === id);
  if (idx === -1) return null;

  if (updates.name != null) albums[idx].name = updates.name;
  albums[idx].updatedAt = new Date().toISOString();

  await writeAlbums(albums);
  logger.info("Album updated", { id });
  return albums[idx];
}

export async function deleteAlbum(id) {
  const albums = await readAlbums();
  const filtered = albums.filter((a) => a.id !== id);
  if (filtered.length === albums.length) return false;

  await writeAlbums(filtered);
  try {
    await fsp.rm(albumItemsDir(id), { recursive: true, force: true });
  } catch { /* ignore */ }
  logger.info("Album deleted", { id });
  return true;
}

export async function getOrCreateAlbumForScene(sceneId, sceneName) {
  const albums = await readAlbums();
  const existing = albums.find((a) => a.sceneId === sceneId);
  if (existing) return existing;
  return createAlbum({ name: sceneName, sceneId });
}

// ── Library Items ──

export async function addItem(albumId, itemData) {
  const items = await readItems(albumId);
  const item = {
    id: uuidv4(),
    albumId,
    title: itemData.title || "",
    description: itemData.description || "",
    imageUrl: itemData.imageUrl,
    filename: itemData.filename,
    sceneId: itemData.sceneId || null,
    itemScale: itemData.itemScale || null,
    shadowIntensity: itemData.shadowIntensity || null,
    mode: itemData.mode || null,
    format: itemData.format || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  items.push(item);
  await writeItems(albumId, items);

  const albums = await readAlbums();
  const albumIdx = albums.findIndex((a) => a.id === albumId);
  if (albumIdx !== -1) {
    albums[albumIdx].updatedAt = new Date().toISOString();
    await writeAlbums(albums);
  }

  logger.info("Library item added", { id: item.id, albumId });
  return item;
}

export async function listItems(albumId) {
  const items = await readItems(albumId);
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getItem(albumId, itemId) {
  const items = await readItems(albumId);
  return items.find((i) => i.id === itemId) || null;
}

export async function updateItem(albumId, itemId, updates) {
  const items = await readItems(albumId);
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx === -1) return null;

  if (updates.title != null) items[idx].title = updates.title;
  if (updates.description != null) items[idx].description = updates.description;
  items[idx].updatedAt = new Date().toISOString();

  await writeItems(albumId, items);
  logger.info("Library item updated", { itemId, albumId });
  return items[idx];
}

export async function deleteItem(albumId, itemId) {
  const items = await readItems(albumId);
  const filtered = items.filter((i) => i.id !== itemId);
  if (filtered.length === items.length) return false;

  await writeItems(albumId, filtered);
  logger.info("Library item deleted", { itemId, albumId });
  return true;
}

export async function moveItem(fromAlbumId, itemId, toAlbumId) {
  const fromItems = await readItems(fromAlbumId);
  const idx = fromItems.findIndex((i) => i.id === itemId);
  if (idx === -1) return null;

  const [item] = fromItems.splice(idx, 1);
  item.albumId = toAlbumId;
  item.updatedAt = new Date().toISOString();

  await writeItems(fromAlbumId, fromItems);

  const toItems = await readItems(toAlbumId);
  toItems.push(item);
  await writeItems(toAlbumId, toItems);

  logger.info("Library item moved", { itemId, from: fromAlbumId, to: toAlbumId });
  return item;
}

export async function searchItems(query) {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const albums = await readAlbums();

  const results = [];
  for (const album of albums) {
    const items = await readItems(album.id);
    const matches = items.filter(
      (i) => i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
    );
    results.push(...matches.map((i) => ({ ...i, albumName: album.name })));
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
