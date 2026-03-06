import { useState, useEffect, useCallback } from "react";
import { listAlbums, createAlbum, saveLibraryItem } from "../services/api.js";
import RichTextEditor from "./RichTextEditor.jsx";

export default function BulkSaveModal({ results, sceneId, sceneName, mode, format, onAllSaved, onSkip }) {
  const successResults = results.filter((r) => r.status === "success");
  const [activeIndex, setActiveIndex] = useState(0);
  const [items, setItems] = useState(() =>
    successResults.map((r) => ({ ...r, title: "", description: "", saved: false }))
  );
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
        if (sceneAlbum) setSelectedAlbumId(sceneAlbum.id);
        else if (list.length > 0) setSelectedAlbumId(list[0].id);
      } catch { /* ignore */ } finally {
        setLoadingAlbums(false);
      }
    })();
  }, [sceneId]);

  const current = items[activeIndex];
  const savedCount = items.filter((i) => i.saved).length;
  const allSaved = savedCount === items.length;

  const updateCurrent = useCallback((field, value) => {
    setItems((prev) => prev.map((item, i) => i === activeIndex ? { ...item, [field]: value } : item));
  }, [activeIndex]);

  const handleCreateAlbum = useCallback(async () => {
    if (!newAlbumName.trim()) return;
    setCreatingAlbum(true);
    try {
      const res = await createAlbum({ name: newAlbumName.trim() });
      const album = res.data;
      setAlbums((prev) => [...prev, album]);
      setSelectedAlbumId(album.id);
      setNewAlbumName("");
    } catch { /* ignore */ } finally {
      setCreatingAlbum(false);
    }
  }, [newAlbumName]);

  const handleSave = useCallback(async () => {
    let albumId = selectedAlbumId;
    if (!albumId) {
      try {
        const res = await createAlbum({ name: sceneName || "Default", sceneId });
        albumId = res.data.id;
        setSelectedAlbumId(albumId);
      } catch { return; }
    }

    setSaving(true);
    try {
      await saveLibraryItem({
        albumId,
        title: current.title.trim(),
        description: current.description,
        imageUrl: current.imageUrl,
        filename: current.filename,
        sceneId,
        itemScale: current.itemScale,
        shadowIntensity: current.shadowIntensity,
        mode,
        format,
      });
      setItems((prev) => prev.map((item, i) => i === activeIndex ? { ...item, saved: true } : item));

      const nextUnsaved = items.findIndex((item, i) => i > activeIndex && !item.saved);
      if (nextUnsaved !== -1) {
        setActiveIndex(nextUnsaved);
      } else {
        const anyUnsaved = items.findIndex((item, i) => i !== activeIndex && !item.saved);
        if (anyUnsaved !== -1) {
          setActiveIndex(anyUnsaved);
        }
      }
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }, [selectedAlbumId, current, activeIndex, items, sceneId, sceneName, mode, format]);

  useEffect(() => {
    if (allSaved && items.length > 0) {
      const timer = setTimeout(() => onAllSaved(), 600);
      return () => clearTimeout(timer);
    }
  }, [allSaved, items.length, onAllSaved]);

  if (successResults.length === 0) return null;

  return (
    <div className="modal-overlay" onClick={onSkip}>
      <div className="modal modal--bulk" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">Save Generated Images</h3>
          <div className="modal__header-info">
            <span className="modal__header-counter">{savedCount}/{items.length} saved</span>
            <button className="modal__close" onClick={onSkip} aria-label="Close">✕</button>
          </div>
        </div>

        <div className="modal__body">
          <div className="modal__bulk-nav">
            <button
              className="modal__bulk-arrow"
              onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}
              disabled={activeIndex === 0}
            >‹</button>
            <span className="modal__bulk-counter">{activeIndex + 1} / {items.length}</span>
            <button
              className="modal__bulk-arrow"
              onClick={() => setActiveIndex(Math.min(items.length - 1, activeIndex + 1))}
              disabled={activeIndex === items.length - 1}
            >›</button>
          </div>

          <div className="modal__preview">
            <img src={current.imageUrl} alt="Generated" className="modal__preview-img" />
            {current.saved && <div className="modal__saved-badge">Saved</div>}
          </div>

          {!current.saved ? (
            <div className="modal__fields">
              <div className="input-group">
                <label className="input-group__label">Item Name</label>
                <input
                  className="input-group__input"
                  type="text"
                  placeholder="e.g. Fiberglass Batt Insulation"
                  value={current.title}
                  onChange={(e) => updateCurrent("title", e.target.value)}
                />
              </div>

              <div className="input-group">
                <label className="input-group__label">Description</label>
                <RichTextEditor
                  key={activeIndex}
                  content={current.description}
                  onChange={(val) => updateCurrent("description", val)}
                />
              </div>

              <div className="input-group">
                <label className="input-group__label">Album</label>
                {loadingAlbums ? (
                  <p className="modal__loading-text">Loading albums…</p>
                ) : (
                  <>
                    <select
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
                      >+ Add</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <p className="modal__already-saved">This image has been saved.</p>
          )}
        </div>

        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onSkip}>
            {allSaved ? "Done" : "Skip All"}
          </button>
          {!current.saved && (
            <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
