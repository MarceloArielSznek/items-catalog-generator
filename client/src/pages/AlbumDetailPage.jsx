import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getAlbumWithItems, updateAlbum, deleteLibraryItem } from "../services/api.js";

export default function AlbumDetailPage() {
  const { albumId } = useParams();
  const navigate = useNavigate();

  const [album, setAlbum] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await getAlbumWithItems(albumId);
      setAlbum(res.data);
      setItems(res.data.items || []);
      setEditName(res.data.name);
    } catch {
      navigate("/library");
    } finally {
      setLoading(false);
    }
  }, [albumId, navigate]);

  useEffect(() => { load(); }, [load]);

  const handleRename = async () => {
    if (!editName.trim()) return;
    await updateAlbum(albumId, { name: editName.trim() });
    setAlbum((prev) => ({ ...prev, name: editName.trim() }));
    setEditing(false);
  };

  const handleDeleteItem = async (e, itemId) => {
    e.stopPropagation();
    if (!confirm("Delete this item?")) return;
    await deleteLibraryItem(itemId, albumId);
    await load();
  };

  const filtered = search.trim()
    ? items.filter((i) => (i.title || "").toLowerCase().includes(search.toLowerCase()))
    : items;

  if (loading) return <main className="page"><p>Loading album…</p></main>;
  if (!album) return null;

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <button className="btn btn--link" onClick={() => navigate("/library")}>← Back to Library</button>
          {editing ? (
            <div className="inline-form inline-form--tight">
              <input
                className="input-group__input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
              />
              <button className="btn btn--primary btn--sm" onClick={handleRename}>Save</button>
              <button className="btn btn--secondary btn--sm" onClick={() => { setEditing(false); setEditName(album.name); }}>Cancel</button>
            </div>
          ) : (
            <h2 className="page__title" onClick={() => setEditing(true)} style={{ cursor: "pointer" }}>
              {album.name} <span className="page__edit-hint">✎</span>
            </h2>
          )}
        </div>
      </div>

      <div className="search-bar">
        <input
          className="search-bar__input"
          type="text"
          placeholder="Search in this album…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="search-bar__clear" onClick={() => setSearch("")}>✕</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="scenes-empty">{search ? "No items match your search" : "No items in this album yet"}</p>
      ) : (
        <div className="library-grid">
          {filtered.map((item) => (
            <div key={item.id} className="library-card" onClick={() => navigate(`/library/${albumId}/${item.id}`)}>
              <div className="library-card__img-wrap">
                <img className="library-card__img" src={item.imageUrl} alt={item.title || "Item"} />
              </div>
              <div className="library-card__body">
                <div className="library-card__title">{item.title || "Untitled"}</div>
                <div className="library-card__meta">{new Date(item.createdAt).toLocaleDateString()}</div>
              </div>
              <button className="library-card__delete" onClick={(e) => handleDeleteItem(e, item.id)} title="Delete">✕</button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
