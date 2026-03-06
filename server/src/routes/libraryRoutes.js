import { Router } from "express";
import {
  createAlbum,
  listAlbums,
  getAlbum,
  updateAlbum,
  deleteAlbum,
  addItem,
  listItems,
  getItem,
  updateItem,
  deleteItem,
  moveItem,
  searchItems,
} from "../services/libraryService.js";

const router = Router();

// ── Albums ──

router.get("/albums", async (_req, res, next) => {
  try {
    const albums = await listAlbums();
    res.json({ success: true, data: albums });
  } catch (err) {
    next(err);
  }
});

router.post("/albums", async (req, res, next) => {
  try {
    const album = await createAlbum({ name: req.body.name, sceneId: req.body.sceneId });
    res.status(201).json({ success: true, data: album });
  } catch (err) {
    next(err);
  }
});

router.get("/albums/:id", async (req, res, next) => {
  try {
    const album = await getAlbum(req.params.id);
    if (!album) return res.status(404).json({ success: false, error: "Album not found" });
    const items = await listItems(req.params.id);
    res.json({ success: true, data: { ...album, items } });
  } catch (err) {
    next(err);
  }
});

router.patch("/albums/:id", async (req, res, next) => {
  try {
    const album = await updateAlbum(req.params.id, req.body);
    if (!album) return res.status(404).json({ success: false, error: "Album not found" });
    res.json({ success: true, data: album });
  } catch (err) {
    next(err);
  }
});

router.delete("/albums/:id", async (req, res, next) => {
  try {
    const ok = await deleteAlbum(req.params.id);
    if (!ok) return res.status(404).json({ success: false, error: "Album not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Items ──

router.get("/albums/:albumId/items", async (req, res, next) => {
  try {
    const items = await listItems(req.params.albumId);
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

router.post("/items", async (req, res, next) => {
  try {
    const { albumId, ...itemData } = req.body;
    if (!albumId) return res.status(400).json({ success: false, error: "albumId is required" });
    const item = await addItem(albumId, itemData);
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

router.patch("/items/:itemId", async (req, res, next) => {
  try {
    const { albumId, ...updates } = req.body;
    if (!albumId) return res.status(400).json({ success: false, error: "albumId is required" });
    const item = await updateItem(albumId, req.params.itemId, updates);
    if (!item) return res.status(404).json({ success: false, error: "Item not found" });
    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

router.post("/items/:itemId/move", async (req, res, next) => {
  try {
    const { fromAlbumId, toAlbumId } = req.body;
    if (!fromAlbumId || !toAlbumId) {
      return res.status(400).json({ success: false, error: "fromAlbumId and toAlbumId are required" });
    }
    const item = await moveItem(fromAlbumId, req.params.itemId, toAlbumId);
    if (!item) return res.status(404).json({ success: false, error: "Item not found" });
    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
});

router.delete("/items/:itemId", async (req, res, next) => {
  try {
    const { albumId } = req.body;
    if (!albumId) return res.status(400).json({ success: false, error: "albumId is required" });
    const ok = await deleteItem(albumId, req.params.itemId);
    if (!ok) return res.status(404).json({ success: false, error: "Item not found" });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── Search ──

router.get("/search", async (req, res, next) => {
  try {
    const results = await searchItems(req.query.q);
    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

export default router;
