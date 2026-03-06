import { listAlbums, createAlbum, saveLibraryItem } from "./api.js";

export async function getOrCreateAlbumForScene(sceneId, sceneName) {
  const res = await listAlbums();
  const existing = res.data.find((a) => a.sceneId === sceneId);
  if (existing) return existing;
  const created = await createAlbum({ name: sceneName, sceneId });
  return created.data;
}

export async function autoSaveGeneratedItem({ sceneId, sceneName, result, itemName, itemScale, shadowIntensity, mode, format }) {
  if (!result || result.stub || !result.imageUrl) return;
  const album = await getOrCreateAlbumForScene(sceneId, sceneName);
  await saveLibraryItem({
    albumId: album.id,
    title: itemName || "",
    description: "",
    imageUrl: result.imageUrl,
    filename: result.filename,
    sceneId,
    itemScale,
    shadowIntensity,
    mode,
    format,
  });
}
