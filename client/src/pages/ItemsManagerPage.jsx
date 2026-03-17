import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import {
  fetchWorkAreas,
  fetchCategoriesByWorkArea,
  fetchCategories,
  fetchItemsByCategory,
  deleteWorkArea,
  deleteCategory,
  invalidatePayloadCache,
} from "../services/payloadApi.js";
import PayloadItemDetailPage from "./PayloadItemDetailPage.jsx";
import WorkAreaFormModal from "../components/WorkAreaFormModal.jsx";
import CategoryFormModal from "../components/CategoryFormModal.jsx";

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
  const { itemId } = useParams();

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

  const [activeTab, setActiveTab] = useState("items");
  const [allCategories, setAllCategories] = useState([]);
  const [loadingAllCategories, setLoadingAllCategories] = useState(false);
  const [workAreaModal, setWorkAreaModal] = useState(null);
  const [categoryModal, setCategoryModal] = useState(null);

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

  useEffect(() => {
    if (activeTab !== "categories") return;
    setLoadingAllCategories(true);
    setError(null);
    fetchCategories()
      .then((res) => setAllCategories(res?.data ?? res ?? []))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingAllCategories(false));
  }, [activeTab]);

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

  const closeItemModal = useCallback(() => {
    navigate("/items", { state: { workAreaId: selectedWA?.id, categoryId: selectedCat?.id } });
  }, [navigate, selectedWA?.id, selectedCat?.id]);

  useEffect(() => {
    if (!itemId) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeItemModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [itemId, closeItemModal]);

  useEffect(() => {
    if (itemId) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [itemId]);

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

      <div className="config-tabs">
        <button
          type="button"
          className={`config-tabs__btn ${activeTab === "items" ? "config-tabs__btn--active" : ""}`}
          onClick={() => setActiveTab("items")}
        >
          Items
        </button>
        <button
          type="button"
          className={`config-tabs__btn ${activeTab === "work-areas" ? "config-tabs__btn--active" : ""}`}
          onClick={() => setActiveTab("work-areas")}
        >
          Work Areas
        </button>
        <button
          type="button"
          className={`config-tabs__btn ${activeTab === "categories" ? "config-tabs__btn--active" : ""}`}
          onClick={() => setActiveTab("categories")}
        >
          Item Categories
        </button>
      </div>

      {activeTab === "work-areas" && (
        <section className="config-section">
          <div className="config-section__header">
            <h3 className="config-section__title">Work Areas</h3>
            <button type="button" className="btn btn--primary" onClick={() => setWorkAreaModal({ id: null })}>
              Add Work Area
            </button>
          </div>
          <ul className="config-list">
            {(Array.isArray(workAreas) ? workAreas : workAreas?.data ?? []).map((wa) => (
              <li key={wa.id} className="config-list__item">
                <span className="config-list__label">{wa.name || "Untitled"}</span>
                <div className="config-list__actions">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setWorkAreaModal({ id: wa.id })}>Edit</button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm config-list__delete"
                    onClick={() => {
                      if (confirm(`Delete work area "${wa.name || "Untitled"}"? This may affect categories linked to it.`)) {
                        deleteWorkArea(wa.id).then(() => loadWorkAreas()).catch((e) => setError(e.message));
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!(Array.isArray(workAreas) ? workAreas : workAreas?.data ?? []).length && !loadingWAs && (
            <p className="config-section__empty">No work areas yet. Add one to get started.</p>
          )}
        </section>
      )}

      {activeTab === "categories" && (
        <section className="config-section">
          <div className="config-section__header">
            <h3 className="config-section__title">Item Categories</h3>
            <button type="button" className="btn btn--primary" onClick={() => setCategoryModal({ id: null })}>
              Add Category
            </button>
          </div>
          {loadingAllCategories ? (
            <p className="config-section__empty">Loading categories...</p>
          ) : (
            <>
              <ul className="config-list">
                {allCategories.map((cat) => (
                  <li key={cat.id} className="config-list__item">
                    <span className="config-list__label">{cat.title || cat.name || "Untitled"}</span>
                    <div className="config-list__actions">
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCategoryModal({ id: cat.id })}>Edit</button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm config-list__delete"
                        onClick={() => {
                          if (confirm(`Delete category "${cat.title || cat.name || "Untitled"}"?`)) {
                            deleteCategory(cat.id).then(() => {
                              setAllCategories((prev) => prev.filter((c) => c.id !== cat.id));
                              invalidatePayloadCache();
                            }).catch((e) => setError(e.message));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {allCategories.length === 0 && (
                <p className="config-section__empty">No categories yet. Add one to get started.</p>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === "items" && (
        <>
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
        </>
      )}

      {workAreaModal && (
        <WorkAreaFormModal
          workAreaId={workAreaModal.id}
          onClose={() => setWorkAreaModal(null)}
          onSaved={() => loadWorkAreas()}
        />
      )}
      {categoryModal && (
        <CategoryFormModal
          categoryId={categoryModal.id}
          onClose={() => setCategoryModal(null)}
          onSaved={() => fetchCategories().then((res) => setAllCategories(res?.data ?? res ?? []))}
        />
      )}

      {itemId && (
        <div
          className="item-detail-modal__overlay"
          onClick={closeItemModal}
          role="dialog"
          aria-modal="true"
          aria-label="Item detail"
        >
          <div
            className="item-detail-modal__content"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="item-detail-modal__close"
              onClick={closeItemModal}
              aria-label="Close"
            >
              ✕
            </button>
            <div className="item-detail-modal__body">
              <PayloadItemDetailPage isModal />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
