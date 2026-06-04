import { useState, useEffect, useCallback, useRef } from "react";
import { uploadOrgLogo, orgLogoUrl, fetchOrgConfig, updateOrgConfig, fetchBaseImages, applyLogoToBaseImages, generateAICatalog, fetchPreGeneratedIds, refreshWebsiteContext, exportEnrichmentPackage, applyEnrichmentPackage } from "../services/enrichApi.js";
import EnrichWizard from "../components/EnrichWizard.jsx";
import LogoLibrary from "../components/LogoLibrary.jsx";
import TrainingWizard from "../components/TrainingWizard.jsx";
import TrainingInsights from "../components/TrainingInsights.jsx";
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
  const [showTrainingWizard, setShowTrainingWizard] = useState(false);
  const [showTrainingInsights, setShowTrainingInsights] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState(new Set());
  const [showWizard, setShowWizard] = useState(false);

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

  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("items");
  const [allCategories, setAllCategories] = useState([]);
  const [loadingAllCategories, setLoadingAllCategories] = useState(false);
  const [workAreaModal, setWorkAreaModal] = useState(null);
  const [categoryModal, setCategoryModal] = useState(null);

  const [orgConfig, setOrgConfig] = useState(null);
  const [baseImageIds, setBaseImageIds] = useState([]);
  const [showBulkApplyModal, setShowBulkApplyModal] = useState(false);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkApplyResults, setBulkApplyResults] = useState(null);

  const [preGeneratedIds, setPreGeneratedIds] = useState([]);
  const [showAICatalogModal, setShowAICatalogModal] = useState(false);
  const [aiCatalogRunning, setAiCatalogRunning] = useState(false);
  const [aiCatalogQuality, setAiCatalogQuality] = useState("medium");
  const [aiCatalogForce, setAiCatalogForce] = useState(false);
  const [aiCatalogLogs, setAiCatalogLogs] = useState([]);
  const [aiCatalogProgress, setAiCatalogProgress] = useState(0);
  const [aiCatalogDone, setAiCatalogDone] = useState(null);
  const [editingWebsiteUrl, setEditingWebsiteUrl] = useState(false);
  const [websiteUrlDraft, setWebsiteUrlDraft] = useState("");
  const [showPackageModal, setShowPackageModal] = useState(false);
  const [packageExporting, setPackageExporting] = useState(false);
  const [packageImporting, setPackageImporting] = useState(false);
  const [packageResult, setPackageResult] = useState(null);

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

  // Load org config (demo vs real) + pre-generated IDs when org changes
  useEffect(() => {
    if (!selectedOrg?.id) { setOrgConfig(null); setPreGeneratedIds([]); return; }
    fetchOrgConfig(selectedOrg.id)
      .then((cfg) => { setOrgConfig(cfg); setWebsiteUrlDraft(cfg.websiteUrl || ""); })
      .catch(() => setOrgConfig({ isDemoOrg: false }));
    fetchPreGeneratedIds(selectedOrg.id)
      .then(setPreGeneratedIds)
      .catch(() => setPreGeneratedIds([]));
  }, [selectedOrg?.id]);

  // Load saved base-image item IDs once on mount
  useEffect(() => {
    fetchBaseImages()
      .then(setBaseImageIds)
      .catch(() => setBaseImageIds([]));
  }, []);

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

  // Items in the current view that have a saved base image and are on a real (non-demo) org
  const bulkEligibleItems = (!orgConfig?.isDemoOrg && items.length > 0)
    ? items.filter(item => baseImageIds.includes(String(item.id)))
    : [];

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
          <h2 className="items-page-header__title">Price Book</h2>
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

            {/* Training buttons */}
            {selectedOrg && (
              <div className="training-btn-group">
                <button
                  className="training-trigger-btn training-trigger-btn--main"
                  onClick={() => setShowTrainingWizard(true)}
                  title="Train the model with your preferences"
                >
                  🎓 Train
                </button>
                <button
                  className="training-trigger-btn training-trigger-btn--insights"
                  onClick={() => setShowTrainingInsights(true)}
                  title="View training insights"
                >
                  📊
                </button>
              </div>
            )}

            {/* Demo / Real org toggle */}
            {selectedOrg && orgConfig !== null && (
              <button
                className={`demo-org-toggle${orgConfig.isDemoOrg ? " demo-org-toggle--active" : ""}`}
                title={orgConfig.isDemoOrg
                  ? "Demo org — base images saved without logo. Click to mark as real client."
                  : "Real client org. Click to mark as industry demo."}
                onClick={() => {
                  const next = !orgConfig.isDemoOrg;
                  updateOrgConfig(selectedOrg.id, { isDemoOrg: next })
                    .then((cfg) => setOrgConfig(cfg))
                    .catch((err) => setError(err.message));
                }}
              >
                {orgConfig.isDemoOrg ? "🎭 Demo" : "🏢 Real"}
              </button>
            )}

            {/* Website URL input */}
            {selectedOrg && (
              editingWebsiteUrl ? (
                <form
                  className="website-url-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const url = websiteUrlDraft.trim();
                    updateOrgConfig(selectedOrg.id, { websiteUrl: url || null })
                      .then((cfg) => { setOrgConfig(cfg); setEditingWebsiteUrl(false); })
                      .catch((err) => setError(err.message));
                  }}
                >
                  <input
                    className="website-url-input"
                    type="url"
                    placeholder="https://company.com"
                    value={websiteUrlDraft}
                    onChange={(e) => setWebsiteUrlDraft(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="website-url-btn website-url-btn--save">Save</button>
                  <button type="button" className="website-url-btn website-url-btn--cancel" onClick={() => { setEditingWebsiteUrl(false); setWebsiteUrlDraft(orgConfig?.websiteUrl || ""); }}>✕</button>
                </form>
              ) : (
                <button
                  className={`website-url-pill${orgConfig?.websiteUrl ? " website-url-pill--set" : ""}`}
                  title={orgConfig?.websiteUrl ? `Company website: ${orgConfig.websiteUrl}` : "Add company website URL for AI image generation"}
                  onClick={() => { setWebsiteUrlDraft(orgConfig?.websiteUrl || ""); setEditingWebsiteUrl(true); }}
                >
                  {orgConfig?.websiteUrl ? "🌐 Website set" : "🌐 Add website"}
                </button>
              )
            )}

            {/* Enrichment package button */}
            {selectedOrg && (
              <button
                className="header-btn header-btn--icon"
                title="Export / Import enrichment package"
                onClick={() => { setPackageResult(null); setShowPackageModal(true); }}
              >
                📦
              </button>
            )}

            {/* Settings button */}
            <button
              className="header-btn header-btn--icon"
              title="Configure price book"
              onClick={() => setShowSettings(!showSettings)}
            >
              ⚙️
            </button>

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

      {showSettings && (
        <div className="config-tabs">
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
      )}

      {showSettings && activeTab === "work-areas" && (
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

      {showSettings && activeTab === "categories" && (
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
                    <button
                      className="items-enrich-btn"
                      onClick={() => setShowWizard(true)}
                    >
                      ✨ Enrich {selectedItemIds.size} item{selectedItemIds.size !== 1 ? "s" : ""}
                    </button>
                  )}
                  {bulkEligibleItems.length > 0 && (
                    <button
                      className="items-enrich-btn items-enrich-btn--logo"
                      onClick={() => { setBulkApplyResults(null); setShowBulkApplyModal(true); }}
                      disabled={bulkApplying}
                      title={`Apply ${selectedOrg?.name} logo to ${bulkEligibleItems.length} items with saved base images`}
                    >
                      🖼 Apply Logo ({bulkEligibleItems.length})
                    </button>
                  )}
                  {orgConfig?.websiteUrl && items.length > 0 && (
                    <button
                      className="items-enrich-btn items-enrich-btn--ai"
                      onClick={() => { setAiCatalogLogs([]); setAiCatalogProgress(0); setAiCatalogDone(null); setShowAICatalogModal(true); }}
                      disabled={aiCatalogRunning}
                      title="Generate images for all items using AI + company website context"
                    >
                      ✨ Generate All with AI
                    </button>
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
                          className={`item-card ${selectedItemIds.has(item.id) ? "item-card--selected" : ""} ${item._justEnriched ? "item-card--enriched" : ""}`}
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
                            {item._justEnriched && (
                              <div className="item-card__enriched-badge">
                                ✨ Done
                              </div>
                            )}
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

      {showTrainingWizard && selectedOrg && (
        <TrainingWizard
          orgId={selectedOrg.id}
          orgName={selectedOrg.name}
          onClose={() => setShowTrainingWizard(false)}
        />
      )}

      {showTrainingInsights && selectedOrg && (
        <TrainingInsights
          orgId={selectedOrg.id}
          orgName={selectedOrg.name}
          onClose={() => setShowTrainingInsights(false)}
        />
      )}

      {showWizard && selectedItemIds.size > 0 && (
        <EnrichWizard
          items={items
            .filter((it) => selectedItemIds.has(it.id))
            .map((it) => ({ id: it.id, name: it.name, categoryName: selectedCat?.title || selectedCat?.name || "" }))}
          orgId={selectedOrg?.id}
          orgName={selectedOrg?.name}
          isDemo={orgConfig?.isDemoOrg ?? false}
          preGeneratedIds={preGeneratedIds}
          onClose={() => { setShowWizard(false); setSelectedItemIds(new Set()); }}
          onFinished={() => { setShowWizard(false); setSelectedItemIds(new Set()); loadItems(selectedCat?.id); }}
        />
      )}

      {showAICatalogModal && (
        <div className="auto-enrich-modal-overlay">
          <div className="auto-enrich-modal">
            <h2>✨ Generate All with AI</h2>

            {!aiCatalogRunning && !aiCatalogDone && (() => {
              const alreadyDone = items.filter(i => preGeneratedIds.includes(String(i.id))).length;
              const toGenerate = aiCatalogForce ? items.length : items.length - alreadyDone;
              return (
              <>
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
                  {alreadyDone > 0 && !aiCatalogForce
                    ? <><strong>{toGenerate} new image{toGenerate !== 1 ? "s" : ""}</strong> will be generated — <span style={{ color: "#16a34a" }}>{alreadyDone} already done</span> will be skipped.</>
                    : <>Will generate an AI image for each of the <strong>{items.length} items</strong> in this category.</>
                  }
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: "#374151", fontWeight: 600 }}>Quality:</label>
                  <select
                    value={aiCatalogQuality}
                    onChange={e => setAiCatalogQuality(e.target.value)}
                    style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontFamily: "inherit", cursor: "pointer" }}
                  >
                    <option value="low">Low — ~$0.016/image (fast)</option>
                    <option value="medium">Medium — ~$0.063/image</option>
                    <option value="high">High — ~$0.25/image (best)</option>
                  </select>
                </div>
                {alreadyDone > 0 && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6b7280", marginBottom: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={aiCatalogForce} onChange={e => setAiCatalogForce(e.target.checked)} />
                    Regenerate all {items.length} (overwrite existing)
                  </label>
                )}
                {orgConfig?.websiteContext ? (
                  <div style={{ fontSize: 12, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "8px 12px", marginBottom: 16 }}>
                    <strong>🌐 {orgConfig.websiteContext.companyName || "Company"}</strong> — {orgConfig.websiteContext.industry}<br />
                    <span style={{ color: "#6b7280" }}>Style: {orgConfig.websiteContext.visualStyle}</span>
                    <button
                      style={{ display: "block", marginTop: 4, fontSize: 11, color: "#6366f1", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      onClick={() => refreshWebsiteContext(selectedOrg.id).then((ctx) => setOrgConfig(c => ({ ...c, websiteContext: ctx }))).catch((err) => setError(err.message))}
                    >
                      ↻ Re-scan website
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: "#92400e", background: "#fef3c7", borderRadius: 6, padding: "6px 10px", marginBottom: 16 }}>
                    ⚠ Website hasn't been scanned yet — will scan on first run.
                  </p>
                )}
                <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 16 }}>
                  Images are saved locally and appear as the top candidate in the Enrich Wizard — you still review each one before it goes live.
                </p>
              </>
              );
            })()}

            {(aiCatalogRunning || aiCatalogDone) && (
              <>
                <div className="auto-enrich-progress-bar" style={{ marginBottom: 8 }}>
                  <div className="auto-enrich-progress-fill" style={{ width: `${aiCatalogProgress}%` }} />
                </div>
                <p className="auto-enrich-progress-text">{aiCatalogProgress}%</p>
                <div className="auto-enrich-logs" style={{ maxHeight: 200 }}>
                  {aiCatalogLogs.map((log, i) => (
                    <p key={i} className="auto-enrich-log-line">{log}</p>
                  ))}
                </div>
              </>
            )}

            {aiCatalogDone && (
              <p style={{ fontSize: 13, marginTop: 8 }}>
                ✅ {aiCatalogDone.succeeded} generated
                {aiCatalogDone.failed > 0 && <> &nbsp;·&nbsp; ❌ {aiCatalogDone.failed} failed</>}
                {aiCatalogDone.skipped > 0 && <> &nbsp;·&nbsp; ⏭ {aiCatalogDone.skipped} skipped</>}
              </p>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button
                className="items-enrich-btn"
                style={{ background: "transparent", border: "1px solid #d1d5db", color: "#374151" }}
                onClick={() => { setShowAICatalogModal(false); if (aiCatalogDone) fetchPreGeneratedIds(selectedOrg.id).then(setPreGeneratedIds).catch(() => {}); }}
                disabled={aiCatalogRunning}
              >
                {aiCatalogDone ? "Close" : "Cancel"}
              </button>
              {!aiCatalogDone && (
                <button
                  className="items-enrich-btn items-enrich-btn--ai"
                  disabled={aiCatalogRunning}
                  onClick={async () => {
                    setAiCatalogRunning(true);
                    setAiCatalogLogs([]);
                    setAiCatalogProgress(0);
                    try {
                      await generateAICatalog(
                        selectedOrg.id,
                        selectedOrg.name,
                        items.map(i => i.id),
                        {
                          force: aiCatalogForce,
                          quality: aiCatalogQuality,
                          onProgress: (data) => {
                            if (data.message) setAiCatalogLogs(prev => [...prev, data.message]);
                            if (data.current != null && data.total)
                              setAiCatalogProgress(Math.round((data.current / data.total) * 100));
                          },
                          onDone: (data) => {
                            setAiCatalogDone(data);
                            setAiCatalogProgress(100);
                            fetchPreGeneratedIds(selectedOrg.id).then(setPreGeneratedIds).catch(() => {});
                          },
                        }
                      );
                    } catch (err) {
                      setError(err.message);
                      setShowAICatalogModal(false);
                    } finally {
                      setAiCatalogRunning(false);
                    }
                  }}
                >
                  {(() => {
                    const toGen = aiCatalogForce ? items.length : items.length - preGeneratedIds.filter(id => items.some(i => String(i.id) === id)).length;
                    return aiCatalogRunning ? "Generating…" : `Generate ${toGen} image${toGen !== 1 ? "s" : ""}`;
                  })()}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showBulkApplyModal && (
        <div className="auto-enrich-modal-overlay">
          <div className="auto-enrich-modal">
            <h2>🖼 Apply Logo to Base Images</h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
              {bulkEligibleItems.length} item{bulkEligibleItems.length !== 1 ? "s" : ""} in this category have saved base images.
              The <strong>{selectedOrg?.name}</strong> logo will be composited onto each and uploaded.
            </p>

            {!bulkApplying && !bulkApplyResults && (
              <ul style={{ fontSize: 13, maxHeight: 200, overflowY: "auto", marginBottom: 16, padding: "0 0 0 1em" }}>
                {bulkEligibleItems.map(item => (
                  <li key={item.id}>{item.name || `Item ${item.id}`}</li>
                ))}
              </ul>
            )}

            {bulkApplying && (
              <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>Processing — this may take a moment…</p>
            )}

            {bulkApplyResults && (
              <div style={{ fontSize: 13, marginBottom: 16 }}>
                <p>✅ {bulkApplyResults.succeeded.length} succeeded</p>
                {bulkApplyResults.failed.length > 0 && (
                  <p>❌ {bulkApplyResults.failed.length} failed: {bulkApplyResults.failed.map(f => f.error).join(", ")}</p>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="items-enrich-btn"
                style={{ background: "transparent", border: "1px solid #d1d5db", color: "#374151" }}
                onClick={() => { setShowBulkApplyModal(false); setBulkApplyResults(null); }}
              >
                {bulkApplyResults ? "Close" : "Cancel"}
              </button>
              {!bulkApplyResults && (
                <button
                  className="items-enrich-btn items-enrich-btn--logo"
                  disabled={bulkApplying}
                  onClick={async () => {
                    setBulkApplying(true);
                    try {
                      const itemIds = bulkEligibleItems.map(i => String(i.id));
                      const results = await applyLogoToBaseImages(selectedOrg.id, itemIds);
                      setBulkApplyResults(results);
                      if (selectedCat?.id) loadItems(selectedCat.id);
                      fetchBaseImages().then(setBaseImageIds).catch(() => {});
                    } catch (err) {
                      setError(err.message);
                      setShowBulkApplyModal(false);
                    } finally {
                      setBulkApplying(false);
                    }
                  }}
                >
                  {bulkApplying ? "Applying…" : "Apply Logo"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showPackageModal && selectedOrg && (
        <div className="auto-enrich-modal-overlay" onClick={() => !packageImporting && !packageExporting && setShowPackageModal(false)}>
          <div className="auto-enrich-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2>📦 Enrichment Package</h2>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
              Export all enriched items for <strong>{selectedOrg.name}</strong> as a ZIP,
              then import it into any other Payload instance by matching item names.
            </p>

            {packageResult && (
              <div style={{ fontSize: 13, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "10px 14px", marginBottom: 16 }}>
                <p style={{ margin: "0 0 4px", fontWeight: 700 }}>✅ {packageResult.applied.length} items applied</p>
                {packageResult.notFound.length > 0 && (
                  <p style={{ margin: "0 0 4px", color: "#92400e" }}>⚠ {packageResult.notFound.length} not found: {packageResult.notFound.slice(0, 3).join(", ")}{packageResult.notFound.length > 3 ? "…" : ""}</p>
                )}
                {packageResult.failed.length > 0 && (
                  <p style={{ margin: 0, color: "#dc2626" }}>❌ {packageResult.failed.length} failed</p>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Export */}
              <button
                className="items-enrich-btn items-enrich-btn--ai"
                style={{ justifyContent: "center" }}
                disabled={packageExporting || packageImporting}
                onClick={async () => {
                  setPackageExporting(true);
                  setPackageResult(null);
                  try {
                    await exportEnrichmentPackage(selectedOrg.id);
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setPackageExporting(false);
                  }
                }}
              >
                {packageExporting ? "Exporting…" : "⬇ Export enrichment ZIP"}
              </button>

              {/* Import */}
              <label
                className="items-enrich-btn"
                style={{ justifyContent: "center", cursor: packageImporting ? "not-allowed" : "pointer", opacity: packageImporting ? 0.6 : 1 }}
              >
                {packageImporting ? "Applying…" : "⬆ Import enrichment ZIP"}
                <input
                  type="file"
                  accept=".zip"
                  style={{ display: "none" }}
                  disabled={packageImporting || packageExporting}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    e.target.value = "";
                    setPackageImporting(true);
                    setPackageResult(null);
                    try {
                      const result = await applyEnrichmentPackage(selectedOrg.id, file);
                      setPackageResult(result);
                    } catch (err) {
                      setError(err.message);
                    } finally {
                      setPackageImporting(false);
                    }
                  }}
                />
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
              <button
                className="items-enrich-btn"
                style={{ background: "transparent", border: "1px solid #d1d5db", color: "#374151" }}
                onClick={() => setShowPackageModal(false)}
                disabled={packageImporting || packageExporting}
              >
                Close
              </button>
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
