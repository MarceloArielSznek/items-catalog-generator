import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { listAlbums, createAlbum, deleteAlbum, searchLibrary } from "../services/api.js";

export default function LibraryPage() {
  const navigate = useNavigate();
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadAlbums = useCallback(async () => {
    try {
      const res = await listAlbums();
      setAlbums(res.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAlbums(); }, [loadAlbums]);

  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    const timeout = setTimeout(async () => {
      try {
        const res = await searchLibrary(search);
        setSearchResults(res.data);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createAlbum({ name: newName.trim() });
      setNewName("");
      setShowCreate(false);
      await loadAlbums();
    } catch { /* ignore */ } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (!confirm("Delete this album and all its items?")) return;
    await deleteAlbum(id);
    await loadAlbums();
  };

  if (loading) return <main className="page"><p>Loading library…</p></main>;

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <h2 className="page__title">Library</h2>
          <p className="page__description">Your generated catalog images</p>
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setShowCreate(true)}>+ New Album</button>
      </div>

      <div className="search-bar">
        <input
          className="search-bar__input"
          type="text"
          placeholder="Search items by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="search-bar__clear" onClick={() => setSearch("")}>✕</button>
        )}
      </div>

      {showCreate && (
        <div className="inline-form">
          <input
            className="input-group__input"
            type="text"
            placeholder="Album name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button className="btn btn--primary btn--sm" onClick={handleCreate} disabled={creating}>
            {creating ? "Creating…" : "Create"}
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => { setShowCreate(false); setNewName(""); }}>Cancel</button>
        </div>
      )}

      {searchResults ? (
        <div className="search-results">
          <p className="search-results__count">{searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{search}"</p>
          {searchResults.length === 0 ? (
            <p className="scenes-empty">No items found</p>
          ) : (
            <div className="library-grid">
              {searchResults.map((item) => (
                <div key={item.id} className="library-card" onClick={() => navigate(`/library/${item.albumId}/${item.id}`)}>
                  <div className="library-card__img-wrap">
                    <img className="library-card__img" src={item.imageUrl} alt={item.title || "Item"} />
                  </div>
                  <div className="library-card__body">
                    <div className="library-card__title">{item.title || "Untitled"}</div>
                    <div className="library-card__meta">{item.albumName}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : albums.length === 0 ? (
        <p className="scenes-empty">No albums yet. Generated images will appear here automatically.</p>
      ) : (
        <div className="albums-grid">
          {albums.map((album) => (
            <div key={album.id} className="album-card" onClick={() => navigate(`/library/${album.id}`)}>
              <div className="album-card__thumb">
                {album.thumbnail ? (
                  <img src={album.thumbnail} alt={album.name} />
                ) : (
                  <div className="album-card__empty">
                    <span>Empty</span>
                  </div>
                )}
              </div>
              <div className="album-card__body">
                <div className="album-card__name">{album.name}</div>
                <div className="album-card__count">{album.itemCount} item{album.itemCount !== 1 ? "s" : ""}</div>
              </div>
              <button className="album-card__delete" onClick={(e) => handleDelete(e, album.id)} title="Delete album">✕</button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
