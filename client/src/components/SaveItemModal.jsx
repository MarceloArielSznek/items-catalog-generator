import { useState, useEffect, useCallback } from "react";
import { listAlbums, createAlbum, saveLibraryItem } from "../services/api.js";
import RichTextEditor from "./RichTextEditor.jsx";

export default function SaveItemModal({ result, sceneId, sceneName, itemName: initialName, itemScale, shadowIntensity, mode, format, onSaved, onSkip }) {
  const [title, setTitle] = useState(initialName || "");
  const [description, setDescription] = useState("");
  const [albums, setAlbums] = useState([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState("");
  const [newAlbumName, setNewAlbumName] = useState("");
  const [creatingAlbum, setCreatingAlbum] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingAlbums, setLoadingAlbums] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await listAlbums();
        const list = res.data || [];
        setAlbums(list);
        const sceneAlbum = list.find((a) => a.sceneId === sceneId);
        if (sceneAlbum) {
          setSelectedAlbumId(sceneAlbum.id);
        } else if (list.length > 0) {
          setSelectedAlbumId(list[0].id);
        }
      } catch {
        // ignore
      } finally {
        setLoadingAlbums(false);
      }
    })();
  }, [sceneId]);

  const handleCreateAlbum = useCallback(async () => {
    if (!newAlbumName.trim()) return;
    setCreatingAlbum(true);
    try {
      const res = await createAlbum({ name: newAlbumName.trim() });
      const album = res.data;
      setAlbums((prev) => [...prev, album]);
      setSelectedAlbumId(album.id);
      setNewAlbumName("");
    } catch {
      // ignore
    } finally {
      setCreatingAlbum(false);
    }
  }, [newAlbumName]);

  const handleSave = useCallback(async () => {
    let albumId = selectedAlbumId;

    if (!albumId) {
      try {
        const res = await createAlbum({ name: sceneName || "Default", sceneId });
        albumId = res.data.id;
      } catch {
        return;
      }
    }

    setSaving(true);
    try {
      await saveLibraryItem({
        albumId,
        title: title.trim(),
        description,
        imageUrl: result.imageUrl,
        filename: result.filename,
        sceneId,
        itemScale,
        shadowIntensity,
        mode,
        format,
      });
      onSaved();
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [selectedAlbumId, title, description, result, sceneId, sceneName, itemScale, shadowIntensity, mode, format, onSaved]);

  return (
    <div className="modal-overlay" onClick={onSkip}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">Save to Library</h3>
          <button className="modal__close" onClick={onSkip} aria-label="Close">✕</button>
        </div>

        <div className="modal__body">
          <div className="modal__preview">
            <img src={result.imageUrl} alt="Generated" className="modal__preview-img" />
          </div>

          <div className="modal__fields">
            <div className="input-group">
              <label className="input-group__label" htmlFor="modal-title">Item Name</label>
              <input
                id="modal-title"
                className="input-group__input"
                type="text"
                placeholder="e.g. Fiberglass Batt Insulation"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="input-group">
              <label className="input-group__label">Description</label>
              <RichTextEditor content={description} onChange={setDescription} />
            </div>

            <div className="input-group">
              <label className="input-group__label" htmlFor="modal-album">Album</label>
              {loadingAlbums ? (
                <p className="modal__loading-text">Loading albums…</p>
              ) : (
                <>
                  <select
                    id="modal-album"
                    className="input-group__input"
                    value={selectedAlbumId}
                    onChange={(e) => setSelectedAlbumId(e.target.value)}
                  >
                    {albums.length === 0 && <option value="">No albums yet</option>}
                    {albums.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <div className="modal__new-album">
                    <input
                      className="input-group__input"
                      type="text"
                      placeholder="New album name"
                      value={newAlbumName}
                      onChange={(e) => setNewAlbumName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateAlbum()}
                    />
                    <button
                      className="btn btn--small"
                      onClick={handleCreateAlbum}
                      disabled={!newAlbumName.trim() || creatingAlbum}
                    >
                      + Add
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onSkip}>Skip</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save to Library"}
          </button>
        </div>
      </div>
    </div>
  );
}
