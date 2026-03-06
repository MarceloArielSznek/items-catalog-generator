import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getAlbumWithItems, updateLibraryItem, listAlbums, moveLibraryItem } from "../services/api.js";
import RichTextEditor from "../components/RichTextEditor.jsx";

export default function ItemDetailPage() {
  const { albumId, itemId } = useParams();
  const navigate = useNavigate();

  const [allItems, setAllItems] = useState([]);
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [albums, setAlbums] = useState([]);
  const [showMove, setShowMove] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getAlbumWithItems(albumId);
      const items = res.data.items || [];
      setAllItems(items);
      const found = items.find((i) => i.id === itemId);
      if (!found) { navigate(`/library/${albumId}`); return; }
      setItem(found);
      setTitle(found.title || "");
      setDescription(found.description || "");
    } catch {
      navigate("/library");
    } finally {
      setLoading(false);
    }
  }, [albumId, itemId, navigate]);

  useEffect(() => { load(); }, [load]);

  const currentIndex = useMemo(() => allItems.findIndex((i) => i.id === itemId), [allItems, itemId]);
  const prevItem = currentIndex > 0 ? allItems[currentIndex - 1] : null;
  const nextItem = currentIndex < allItems.length - 1 ? allItems[currentIndex + 1] : null;

  const goTo = useCallback((id) => {
    navigate(`/library/${albumId}/${id}`, { replace: true });
  }, [albumId, navigate]);

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      if (e.key === "ArrowLeft" && prevItem) goTo(prevItem.id);
      if (e.key === "ArrowRight" && nextItem) goTo(nextItem.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevItem, nextItem, goTo]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await updateLibraryItem(itemId, { albumId, title, description });
      setItem(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally {
      setSaving(false);
    }
  }, [itemId, albumId, title, description]);

  const handleMove = async (toAlbumId) => {
    await moveLibraryItem(itemId, albumId, toAlbumId);
    navigate(`/library/${toAlbumId}/${itemId}`);
  };

  const loadAlbums = async () => {
    const res = await listAlbums();
    setAlbums(res.data.filter((a) => a.id !== albumId));
    setShowMove(true);
  };

  if (loading) return <main className="page"><p>Loading…</p></main>;
  if (!item) return null;

  return (
    <main className="page page--item-detail">
      <div className="page-header page-header--compact">
        <button className="btn btn--link" onClick={() => navigate(`/library/${albumId}`)}>← Back to Album</button>
        {allItems.length > 1 && (
          <span className="item-detail__counter">{currentIndex + 1} / {allItems.length}</span>
        )}
      </div>

      <div className="item-detail">
        {prevItem && (
          <button className="item-detail__nav item-detail__nav--prev" onClick={() => goTo(prevItem.id)} aria-label="Previous">‹</button>
        )}
        {nextItem && (
          <button className="item-detail__nav item-detail__nav--next" onClick={() => goTo(nextItem.id)} aria-label="Next">›</button>
        )}

        <div className="item-detail__image-section">
          <div className="item-detail__image-wrap">
            <img className="item-detail__image" src={item.imageUrl} alt={item.title || "Item"} />
          </div>
        </div>

        <div className="item-detail__editor-section">
          <div className="input-group">
            <label className="input-group__label" htmlFor="itemTitle">Title</label>
            <input
              id="itemTitle"
              className="input-group__input"
              type="text"
              placeholder="e.g. R-38, 24&quot; UF Batts"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="input-group" style={{ marginTop: 16 }}>
            <label className="input-group__label">Description</label>
            <RichTextEditor content={description} onChange={setDescription} />
          </div>

          <div className="item-detail__actions-row">
            <button className="btn btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <a className="btn btn--ghost btn--sm" href={item.imageUrl} download={item.filename} target="_blank" rel="noreferrer">
              Download
            </a>
            <button className="btn btn--ghost btn--sm" onClick={loadAlbums}>Move</button>
            {saved && <span className="item-detail__saved-msg">Saved!</span>}
          </div>

          {showMove && (
            <div className="item-detail__move-list">
              {albums.length === 0 ? (
                <p className="item-detail__move-empty">No other albums available</p>
              ) : albums.map((a) => (
                <button key={a.id} className="item-detail__move-option" onClick={() => handleMove(a.id)}>
                  {a.name}
                </button>
              ))}
              <button className="btn btn--ghost btn--sm" onClick={() => setShowMove(false)} style={{ marginTop: 8 }}>Cancel</button>
            </div>
          )}

          {item.mode && (
            <div className="item-detail__meta">
              <span>{item.mode}</span>
              <span className="item-detail__meta-sep">·</span>
              <span>{item.format}</span>
              {item.itemScale && (
                <>
                  <span className="item-detail__meta-sep">·</span>
                  <span>{Math.round(item.itemScale * 100)}%</span>
                </>
              )}
            </div>
          )}
        </div>

        {allItems.length > 1 && (
          <div className="item-detail__mobile-nav">
            <button className="item-detail__mobile-arrow" onClick={() => prevItem && goTo(prevItem.id)} disabled={!prevItem}>‹ Prev</button>
            <span className="item-detail__counter">{currentIndex + 1} / {allItems.length}</span>
            <button className="item-detail__mobile-arrow" onClick={() => nextItem && goTo(nextItem.id)} disabled={!nextItem}>Next ›</button>
          </div>
        )}
      </div>
    </main>
  );
}
