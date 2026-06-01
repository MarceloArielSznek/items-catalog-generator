import { useState, useEffect, useCallback, useRef } from "react";
import { uploadOrgLogo, orgLogoUrl, autoEnrichBatch } from "../services/enrichApi.js";
import EnrichWizard from "../components/EnrichWizard.jsx";
import LogoLibrary from "../components/LogoLibrary.jsx";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import {
  fetchWorkAreas,
  fetchCategoriesByWorkArea,
  fetchCategories,
  fetchItemsByCategory,
  fetchOrganizations,
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

const PAYLOAD_BASE = "https://pr-819.preview.menaia.com";
const ITEMS_PER_PAGE = 8;

export default function ItemsManagerPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { itemId } = useParams();

  const [organizations, setOrganizations] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [logoRefresh, setLogoRefresh] = useState(0);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);
  const [showLogoLibrary, setShowLogoLibrary] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState(new Set());
  const [showWizard, setShowWizard] = useState(false);
  const [autoEnriching, setAutoEnriching] = useState(false);
  const [autoEnrichProgress, setAutoEnrichProgress] = useState(0);
  const [autoEnrichLogs, setAutoEnrichLogs] = useState([]);

  const [workAreas, setWorkAreas] = useState([]);
  const [selectedWA, setSelectedWA] = useState(null);
  const [loadingWAs, setLoadingWAs] = useState(false);

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

  // Load organizations once on mount
  useEffect(() => {
    setLoadingOrgs(true);
    fetchOrganizations()
      .then((orgs) => {
        const list = Array.isArray(orgs) ? orgs : orgs?.data ?? [];
        setOrganizations(list);
        if (list.length > 0) setSelectedOrg(list[0]);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingOrgs(false));
  }, []);

  const loadWorkAreas = useCallback(async (orgId) => {
    if (!orgId) return;
    setLoadingWAs(true);
    try {
      setError(null);
      const res = await fetchWorkAreas(orgId);
      const sorted = (res.data || []).sort((a, b) =>
        (a.name || "").localeCompare(b.name || ""),
      );
      setWorkAreas(sorted);
      if (sorted.length > 0) {
        const restore = incomingWorkAreaId
          ? sorted.find((wa) => String(wa.id) === String(incomingWorkAreaId))
          : null;
        setSelectedWA(restore || sorted[0]);
      } else {
        setSelectedWA(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingWAs(false);
    }
  }, [incomingWorkAreaId]);

  // Reload work areas when selected org changes
  useEffect(() => {
    if (selectedOrg?.id) {
      setWorkAreas([]);
      setSelectedWA(null);
      setCategories([]);
      setSelectedCat(null);
      setItems([]);
      loadWorkAreas(selectedOrg.id);
    }
  }, [selectedOrg]);

  useEffect(() => {
    if (activeTab !== "categories") return;
    setLoadingAllCategories(true);
    setError(null);
    fetchCategories(selectedOrg?.id)
      .then((res) => setAllCategories(res?.data ?? res ?? []))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingAllCategories(false));
  }, [activeTab, selectedOrg]);

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

  const handleAutoEnrich = useCallback(async () => {
    if (selectedItemIds.size === 0) return;

    setAutoEnriching(true);
    setAutoEnrichProgress(0);
    setAutoEnrichLogs([]);

    try {
      const itemIds = Array.from(selectedItemIds);
      await autoEnrichBatch(itemIds, selectedOrg?.id, selectedOrg?.name, {
        onProgress: (data) => {
          const percent = Math.round((data.current / data.total) * 100);
          setAutoEnrichProgress(percent);
        },
        onLog: (message) => {
          setAutoEnrichLogs((prev) => [...prev, message]);
        },
      });

      // Success! Reload items
      if (selectedCat?.id) {
        loadItems(selectedCat.id);
      }

      setSelectedItemIds(new Set());
    } catch (err) {
      setAutoEnrichLogs((prev) => [...prev, `❌ Error: ${err.message}`]);
    } finally {
      setAutoEnriching(false);
    }
  }, [selectedItemIds, selectedOrg, selectedCat, loadItems]);

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

  if (loadingOrgs) {
    return (
      <main className="page page--items-manager page--items-fixed">
        <p>Loading organizations...</p>
      </main>
    );
  }

  return (
    <main className="page page--items-manager page--items-fixed">
      <div className="items-page-header">
        <div className="items-page-header__left">
          <h2 className="items-page-header__title">Items</h2>
          {selectedOrg && (
            <span className="items-page-header__org-badge">
              {selectedOrg.name}
            </span>
          )}
        </div>
        {organizations.length > 0 && (
          <div className="org-selector-group">
            {/* Logo Library button */}
            {selectedOrg && (
              <button
                className="org-logo-btn"
                title="Manage logo library"
                onClick={() => setShowLogoLibrary(true)}
              >
                <img
                  key={`${selectedOrg.id}-${logoRefresh}`}
                  src={`${orgLogoUrl(selectedOrg.id)}?t=${logoRefresh}`}
                  alt=""
                  className="org-logo-btn__img"
                  onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
                />
                <span className="org-logo-btn__placeholder" style={{ display: "none" }}>🎨</span>
              </button>
            )}

          <div className="org-selector">
            <svg className="org-selector__icon" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.357l4-2a1 1 0 11.788 1.84L7.667 8.94l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.84l-7-3z" />
              <path d="M3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zm5.99 7.176A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
            </svg>
            <select
              id="org-select"
              className="org-selector__select"
              value={selectedOrg?.id ?? ""}
              onChange={(e) => {
                const org = organizations.find((o) => String(o.id) === e.target.value);
                if (org) setSelectedOrg(org);
              }}
            >
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name || `Org ${org.id}`}
                </option>
              ))}
            </select>
          </div>
          </div>
        )}
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
          {/* Work area strip */}
          <div className="wa-strip">
            {loadingWAs ? (
              <div className="wa-strip__loading">Loading…</div>
            ) : (
              workAreas.map((wa) => (
                <button
                  key={wa.id}
                  className={`wa-strip__btn ${selectedWA?.id === wa.id ? "wa-strip__btn--active" : ""}`}
                  onClick={() => setSelectedWA(wa)}
                >
                  {wa.name || "Untitled"}
                </button>
              ))
            )}
          </div>

          <div className="items-layout items-layout--fixed">
            {/* Categories sidebar */}
            <aside className="items-sidebar">
              <div className="items-sidebar__header">
                <span>Categories</span>
                {categories.length > 0 && (
                  <span className="items-sidebar__count">{categories.length}</span>
                )}
              </div>
              {loadingCats ? (
                <div className="items-sidebar__loading">
                  {[1,2,3,4].map(i => <div key={i} className="items-sidebar__skeleton" />)}
                </div>
              ) : (
                <>
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      className={`items-sidebar__item ${selectedCat?.id === cat.id ? "items-sidebar__item--active" : ""}`}
                      onClick={() => setSelectedCat(cat)}
                    >
                      <span className="items-sidebar__item-name">{cat.title || cat.name || "Untitled"}</span>
                      {selectedCat?.id === cat.id && items.length > 0 && (
                        <span className="items-sidebar__item-badge">{items.length}</span>
                      )}
                    </button>
                  ))}
                  {categories.length === 0 && (
                    <div className="items-sidebar__empty">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                      <p>No categories</p>
                    </div>
                  )}
                </>
              )}
            </aside>

            {/* Items content */}
            <section className="items-content">
              {/* Toolbar */}
              <div className="items-toolbar">
                <div className="items-toolbar__search">
                  <svg className="items-toolbar__search-icon" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                  <input
                    className="items-toolbar__search-input"
                    type="text"
                    placeholder={selectedCat ? `Search in ${selectedCat.title || selectedCat.name}…` : "Search items…"}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button className="items-toolbar__search-clear" onClick={() => setSearch("")}>
                      ✕
                    </button>
                  )}
                </div>
                <div className="items-toolbar__right">
                  {selectedCat && (
                    <span className="items-toolbar__cat-label">
                      {selectedCat.title || selectedCat.name}
                      <span className="items-toolbar__cat-count">{filteredItems.length}</span>
                    </span>
                  )}
                  {selectedItemIds.size > 0 && (
                    <div className="items-enrich-group">
                      <button
                        className="items-enrich-btn items-enrich-btn--auto"
                        onClick={handleAutoEnrich}
                        disabled={autoEnriching}
                      >
                        {autoEnriching ? `⏳ ${autoEnrichProgress}%` : "🚀 Auto-Enrich"}
                      </button>
                      <button
                        className="items-enrich-btn"
                        onClick={() => setShowWizard(true)}
                        disabled={autoEnriching}
                      >
                        ✨ Enrich {selectedItemIds.size} item{selectedItemIds.size !== 1 ? "s" : ""}
                      </button>
                    </div>
                  )}
                  <select
                    className="items-sort"
                    value={sortBy}
                    onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                  >
                    <option value="name-asc">A → Z</option>
                    <option value="name-desc">Z → A</option>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="updated">Updated</option>
                  </select>
                </div>
              </div>

              {/* Grid */}
              <div className="items-content__grid-area">
                {pagedItems.length > 0 && (
                  <div className="items-grid-header">
                    <label className="items-select-all">
                      <input
                        type="checkbox"
                        checked={pagedItems.length > 0 && pagedItems.every(item => selectedItemIds.has(item.id))}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const allIds = new Set(pagedItems.map(item => item.id));
                            setSelectedItemIds(allIds);
                          } else {
                            setSelectedItemIds(new Set());
                          }
                        }}
                      />
                      Select all on page ({pagedItems.length})
                    </label>
                  </div>
                )}
                {loadingItems ? (
                  <div className="items-grid-skeleton">
                    {[1,2,3,4,5,6].map(i => <div key={i} className="items-card-skeleton" />)}
                  </div>
                ) : pagedItems.length === 0 ? (
                  <div className="items-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                    </svg>
                    <p>{search ? "No items match your search" : selectedCat ? "No items in this category" : "Select a category"}</p>
                  </div>
                ) : (
                  <div className="items-grid">
                    {pagedItems.map((item) => {
                      const thumb = getItemThumbnail(item, PAYLOAD_BASE);
                      return (
                        <div
                          key={item.id}
                          className={`item-card ${selectedItemIds.has(item.id) ? "item-card--selected" : ""}`}
                          onClick={() => navigate(`/items/${item.id}`, { state: { fromWorkAreaId: selectedWA?.id, fromCategoryId: selectedCat?.id } })}
                        >
                          <input
                            type="checkbox"
                            className="item-card__checkbox"
                            checked={selectedItemIds.has(item.id)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation();
                              setSelectedItemIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(item.id);
                                else next.delete(item.id);
                                return next;
                              });
                            }}
                          />
                          <div className="item-card__img-wrap">
                            {thumb ? (
                              <img className="item-card__img" src={thumb} alt={item.name || "Item"} loading="lazy" />
                            ) : (
                              <div className="item-card__no-img">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 21h10.5A2.25 2.25 0 0019.5 18.75V6.75A2.25 2.25 0 0017.25 4.5H6.75A2.25 2.25 0 004.5 6.75v12A2.25 2.25 0 006.75 21zM16.5 8.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                                </svg>
                              </div>
                            )}
                            <div className="item-card__overlay">
                              <span className="item-card__edit-btn">Edit →</span>
                            </div>
                          </div>
                          <div className="item-card__body">
                            <p className="item-card__name">{item.name || "Untitled"}</p>
                            <div className="item-card__meta">
                              {item.unit && <span className="item-card__badge">{item.unit}</span>}
                              {item.materialCost != null && (
                                <span className="item-card__cost">${Number(item.materialCost).toFixed(2)}</span>
                              )}
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
                  <button className="items-pagination__btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                  <span className="items-pagination__info">Page {page} / {totalPages}</span>
                  <button className="items-pagination__btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
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

      {showLogoLibrary && selectedOrg && (
        <LogoLibrary
          orgId={selectedOrg.id}
          onClose={() => { setShowLogoLibrary(false); setLogoRefresh(Date.now()); }}
        />
      )}

      {showWizard && selectedItemIds.size > 0 && (
        <EnrichWizard
          items={items
            .filter((it) => selectedItemIds.has(it.id))
            .map((it) => ({ id: it.id, name: it.name, categoryName: selectedCat?.title || selectedCat?.name || "" }))}
          orgId={selectedOrg?.id}
          orgName={selectedOrg?.name}
          onClose={() => { setShowWizard(false); setSelectedItemIds(new Set()); }}
          onFinished={() => { setShowWizard(false); setSelectedItemIds(new Set()); loadItems(selectedCat?.id); }}
        />
      )}

      {autoEnriching && (
        <div className="auto-enrich-modal-overlay">
          <div className="auto-enrich-modal">
            <h2>🚀 Auto-Enriching {selectedItemIds.size} items...</h2>
            <div className="auto-enrich-progress-bar">
              <div className="auto-enrich-progress-fill" style={{ width: `${autoEnrichProgress}%` }}></div>
            </div>
            <p className="auto-enrich-progress-text">{autoEnrichProgress}%</p>

            <div className="auto-enrich-logs">
              {autoEnrichLogs.map((log, i) => (
                <p key={i} className="auto-enrich-log-line">
                  {log}
                </p>
              ))}
            </div>
          </div>
        </div>
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
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            <div className="item-detail-modal__body">
              <PayloadItemDetailPage isModal orgId={selectedOrg?.id} orgName={selectedOrg?.name} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
