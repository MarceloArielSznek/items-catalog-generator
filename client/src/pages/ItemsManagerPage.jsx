import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  fetchWorkAreas,
  fetchCategoriesByWorkArea,
  fetchItemsByCategory,
} from "../services/payloadApi.js";

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
const ITEMS_PER_PAGE = 8;

export default function ItemsManagerPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [workAreas, setWorkAreas] = useState([]);
  const [selectedWA, setSelectedWA] = useState(null);
  const [loadingWAs, setLoadingWAs] = useState(true);

  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState(null);
  const [loadingCats, setLoadingCats] = useState(false);

  const [items, setItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name-asc");
  const [page, setPage] = useState(1);

  const incomingWorkAreaId = location.state?.workAreaId ?? location.state?.fromWorkAreaId;
  const incomingCategoryId = location.state?.categoryId ?? location.state?.fromCategoryId;

  const loadWorkAreas = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchWorkAreas();
      const sorted = (res.data || []).sort((a, b) =>
        (a.name || "").localeCompare(b.name || ""),
      );
      setWorkAreas(sorted);
      if (sorted.length > 0 && !selectedWA) {
        const restore = incomingWorkAreaId
          ? sorted.find((wa) => String(wa.id) === String(incomingWorkAreaId))
          : null;
        setSelectedWA(restore || sorted[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingWAs(false);
    }
  }, [incomingWorkAreaId]);

  useEffect(() => {
    loadWorkAreas();
  }, [loadWorkAreas]);

  const loadCategories = useCallback(async (waId) => {
    if (!waId) return;
    setLoadingCats(true);
    setError(null);
    try {
      const res = await fetchCategoriesByWorkArea(waId);
      const sorted = (res.data || []).sort((a, b) =>
        (a.title || a.name || "").localeCompare(b.title || b.name || ""),
      );
      setCategories(sorted);
      if (sorted.length > 0) {
        const restore = incomingCategoryId
          ? sorted.find((c) => String(c.id) === String(incomingCategoryId))
          : null;
        setSelectedCat(restore || sorted[0]);
      } else {
        setSelectedCat(null);
        setItems([]);
      }
    } catch (err) {
      setError(err.message);
      setCategories([]);
      setSelectedCat(null);
      setItems([]);
    } finally {
      setLoadingCats(false);
    }
  }, [incomingCategoryId]);

  useEffect(() => {
    if (selectedWA?.id) {
      setSelectedCat(null);
      setItems([]);
      setSearch("");
      setPage(1);
      loadCategories(selectedWA.id);
    }
  }, [selectedWA, loadCategories]);

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
      setPage(1);
      loadItems(selectedCat.id);
    }
  }, [selectedCat, loadItems]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const filteredItems = (() => {
    let result = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((item) => {
        const name = (item.name || "").toLowerCase();
        const desc = (item.itemInfo || "").toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    }
    return [...result].sort((a, b) => {
      switch (sortBy) {
        case "name-asc":
          return (a.name || "").localeCompare(b.name || "");
        case "name-desc":
          return (b.name || "").localeCompare(a.name || "");
        case "newest":
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case "oldest":
          return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        case "updated":
          return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
        default:
          return 0;
      }
    });
  })();

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const pagedItems = filteredItems.slice(
    (page - 1) * ITEMS_PER_PAGE,
    page * ITEMS_PER_PAGE,
  );

  if (loadingWAs) {
    return (
      <main className="page page--items-manager page--items-fixed">
        <p>Loading work areas...</p>
      </main>
    );
  }

  return (
    <main className="page page--items-manager page--items-fixed">
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

      <div className="wa-selector">
        {workAreas.map((wa) => (
          <button
            key={wa.id}
            className={`wa-selector__btn ${selectedWA?.id === wa.id ? "wa-selector__btn--active" : ""}`}
            onClick={() => setSelectedWA(wa)}
          >
            {wa.name || "Untitled"}
          </button>
        ))}
      </div>

      <div className="items-layout items-layout--fixed">
        <aside className="items-sidebar">
          <div className="items-sidebar__header">Categories</div>
          {loadingCats ? (
            <p className="items-sidebar__empty">Loading...</p>
          ) : (
            <>
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
                <p className="items-sidebar__empty">No categories in this work area</p>
              )}
            </>
          )}
        </aside>

        <section className="items-content">
          <div className="items-content__top">
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

            <div className="items-toolbar">
              <div className="search-bar search-bar--flex">
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
              <select
                className="items-sort"
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
              >
                <option value="name-asc">A → Z</option>
                <option value="name-desc">Z → A</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="updated">Recently updated</option>
              </select>
            </div>
          </div>

          <div className="items-content__grid-area">
            {loadingItems ? (
              <p className="scenes-empty">Loading items...</p>
            ) : pagedItems.length === 0 ? (
              <p className="scenes-empty">
                {search ? "No items match your filter" : "No items in this category"}
              </p>
            ) : (
              <div className="library-grid">
                {pagedItems.map((item) => {
                  const thumb = getItemThumbnail(item, PAYLOAD_BASE);
                  return (
                    <div
                      key={item.id}
                      className="library-card"
                      onClick={() => navigate(`/items/${item.id}`, { state: { fromWorkAreaId: selectedWA?.id, fromCategoryId: selectedCat?.id } })}
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
          </div>

          {totalPages > 1 && (
            <div className="items-pagination">
              <button
                className="items-pagination__btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Prev
              </button>
              <span className="items-pagination__info">
                Page {page} of {totalPages}
              </span>
              <button
                className="items-pagination__btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
