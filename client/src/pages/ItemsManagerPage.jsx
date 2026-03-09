import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { fetchCategories, fetchItemsByCategory } from "../services/payloadApi.js";

function getItemThumbnail(item, baseUrl) {
  const media = item?.media;
  if (!media) return null;
  const first = Array.isArray(media) ? media[0] : media;
  if (!first) return null;
  const url = first?.url || first?.sizes?.thumbnail?.url;
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${baseUrl}${url}`;
}

const PAYLOAD_BASE = "https://www.attic-tech.com";

export default function ItemsManagerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);
  const [items, setItems] = useState([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  const incomingCategoryId = location.state?.categoryId ?? location.state?.fromCategoryId;

  const loadCategories = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchCategories();
      const sorted = (res.data || []).sort((a, b) =>
        (a.title || a.name || "").localeCompare(b.title || b.name || ""),
      );
      setCategories(sorted);
      if (sorted.length > 0 && !selectedCat) {
        setSelectedCat(sorted[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingCats(false);
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (categories.length === 0 || incomingCategoryId == null) return;
    const cat = categories.find((c) => String(c.id) === String(incomingCategoryId));
    if (cat) setSelectedCat(cat);
  }, [categories, incomingCategoryId]);

  const loadItems = useCallback(async (catId) => {
    if (!catId) return;
    setLoadingItems(true);
    setError(null);
    try {
      const res = await fetchItemsByCategory(catId);
      setItems(res.data || []);
    } catch (err) {
      setError(err.message);
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    if (selectedCat?.id) {
      loadItems(selectedCat.id);
    }
  }, [selectedCat, loadItems]);

  const filteredItems = search.trim()
    ? items.filter((item) => {
        const q = search.toLowerCase();
        const name = (item.name || "").toLowerCase();
        const desc = (item.itemInfo || "").toLowerCase();
        return name.includes(q) || desc.includes(q);
      })
    : items;

  if (loadingCats) {
    return (
      <main className="page">
        <p>Loading categories...</p>
      </main>
    );
  }

  return (
    <main className="page page--items-manager">
      <div className="page-header">
        <div>
          <h2 className="page__title">Items Manager</h2>
          <p className="page__description">
            Browse and edit items from Payload CMS
          </p>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-banner__icon">!</span>
          <span className="error-banner__message">{error}</span>
        </div>
      )}

      <div className="items-layout">
        <aside className="items-sidebar">
          <div className="items-sidebar__header">Categories</div>
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`items-sidebar__item ${selectedCat?.id === cat.id ? "items-sidebar__item--active" : ""}`}
              onClick={() => setSelectedCat(cat)}
            >
              {cat.title || cat.name || "Untitled"}
            </button>
          ))}
          {categories.length === 0 && (
            <p className="items-sidebar__empty">No categories found</p>
          )}
        </aside>

        <section className="items-content">
          {selectedCat && (
            <div className="items-content__header">
              <h3 className="items-content__cat-name">
                {selectedCat.title || selectedCat.name}
              </h3>
              <span className="items-content__count">
                {filteredItems.length} item{filteredItems.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}

          <div className="search-bar">
            <input
              className="search-bar__input"
              type="text"
              placeholder="Filter items by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="search-bar__clear"
                onClick={() => setSearch("")}
              >
                ✕
              </button>
            )}
          </div>

          {loadingItems ? (
            <p className="scenes-empty">Loading items...</p>
          ) : filteredItems.length === 0 ? (
            <p className="scenes-empty">
              {search ? "No items match your filter" : "No items in this category"}
            </p>
          ) : (
            <div className="library-grid">
              {filteredItems.map((item) => {
                const thumb = getItemThumbnail(item, PAYLOAD_BASE);
                return (
                  <div
                    key={item.id}
                    className="library-card"
                    onClick={() => navigate(`/items/${item.id}`, { state: { fromCategoryId: selectedCat?.id } })}
                  >
                    <div className="library-card__img-wrap">
                      {thumb ? (
                        <img
                          className="library-card__img"
                          src={thumb}
                          alt={item.name || "Item"}
                          loading="lazy"
                        />
                      ) : (
                        <div className="library-card__placeholder">
                          No image
                        </div>
                      )}
                    </div>
                    <div className="library-card__body">
                      <div className="library-card__title">
                        {item.name || "Untitled"}
                      </div>
                      <div className="library-card__meta">
                        {item.unit || ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
