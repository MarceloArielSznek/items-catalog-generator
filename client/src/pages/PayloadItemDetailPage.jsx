import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { fetchItem, updatePayloadItem, uploadItemMedia, detachItemMedia, invalidatePayloadCache, fetchFactors, fetchAdditionalCosts } from "../services/payloadApi.js";
import RichTextEditor from "../components/RichTextEditor.jsx";
import { htmlToMarkdown, markdownToHtml, looksLikeHtml } from "../utils/markdownPayload.js";
import { validateMediaFile } from "../utils/fileHelpers.js";

const PAYLOAD_BASE = "https://pr-819.preview.menaia.com";

const UNIT_OPTIONS = [
  "",
  "Sq. Ft.",
  "Big Sq.",
  "Dollars",
  "Linear Feet",
  "Each",
  "Hours",
];

function resolveMediaUrl(url) {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  return `${PAYLOAD_BASE}${url}`;
}

function isVideoFilename(filename) {
  const ext = (filename || "").toLowerCase();
  return ext.endsWith(".mp4") || ext.endsWith(".mov");
}

function extractMediaList(item) {
  const raw = item?.media;
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .filter((m) => m && (m.url || m.sizes?.thumbnail?.url))
    .map((m) => ({
      id: m.id,
      url: resolveMediaUrl(m.url),
      thumbUrl: resolveMediaUrl(m.sizes?.thumbnail?.url || m.url),
      filename: m.filename || "",
      isVideo: isVideoFilename(m.filename) || (m.mimeType || "").startsWith("video/"),
    }));
}

export default function PayloadItemDetailPage({ isModal = false, orgId = null, orgName = "" }) {
  const { itemId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef(null);

  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("");
  const [materialCost, setMaterialCost] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [multiplierOverride, setMultiplierOverride] = useState("");
  const [subItem, setSubItem] = useState(false);
  const [requiresInfo, setRequiresInfo] = useState(false);
  const [factors, setFactors] = useState([]);
  const [additionalCosts, setAdditionalCosts] = useState([]);
  const [factorsOptions, setFactorsOptions] = useState([]);
  const [additionalCostsOptions, setAdditionalCostsOptions] = useState([]);
  const [extraFields, setExtraFields] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  const [mediaList, setMediaList] = useState([]);
  const [selectedMedia, setSelectedMedia] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [detaching, setDetaching] = useState(null);

  const RESERVED_ITEM_KEYS = new Set([
    "id", "name", "itemInfo", "category", "media", "createdAt", "updatedAt",
    "unit", "materialCost", "laborHours", "multiplierOverride", "subItem", "requiresInfo",
    "factors", "additional_costs",
  ]);

  function getScalarExtraFields(data) {
    if (!data || typeof data !== "object") return {};
    const out = {};
    for (const [key, value] of Object.entries(data)) {
      if (RESERVED_ITEM_KEYS.has(key)) continue;
      if (value === null || value === undefined) continue;
      if (typeof value === "object" && !Array.isArray(value)) continue;
      if (Array.isArray(value)) continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        out[key] = value;
      }
    }
    return out;
  }

  const loadItem = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchItem(itemId);
      const data = res.data || res;
      setItem(data);
      setName(data.name || "");
      const raw = data.itemInfo || "";
      setDescription(looksLikeHtml(raw) ? raw : markdownToHtml(raw));
      setUnit(data.unit ?? "");
      setMaterialCost(data.materialCost != null ? String(data.materialCost) : "");
      setLaborHours(data.laborHours != null ? String(data.laborHours) : "");
      setMultiplierOverride(data.multiplierOverride != null && data.multiplierOverride !== "" ? String(data.multiplierOverride) : "");
      setSubItem(!!data.subItem);
      setRequiresInfo(!!data.requiresInfo);
      const fac = data.factors;
      const facList = fac == null ? [] : Array.isArray(fac) ? fac : [fac];
      setFactors(facList.map((entry) => {
        if (entry == null) return { id: null, label: "" };
        if (typeof entry === "object" && "id" in entry) {
          return { id: entry.id, label: entry.name || entry.title || `ID: ${entry.id}` };
        }
        return { id: entry, label: `ID: ${entry}` };
      }).filter((x) => x.id != null));
      const ac = data.additional_costs;
      if (Array.isArray(ac)) {
        setAdditionalCosts(ac.map((entry) => {
          if (entry == null) return { id: null, label: "" };
          if (typeof entry === "object" && "id" in entry) {
            return { id: entry.id, label: entry.title || entry.name || `ID: ${entry.id}` };
          }
          return { id: entry, label: `ID: ${entry}` };
        }).filter((x) => x.id != null));
      } else {
        setAdditionalCosts([]);
      }
      setExtraFields(getScalarExtraFields(data));
      setDirty(false);
      setMediaList(extractMediaList(data));
      setSelectedMedia(0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => { loadItem(); }, [loadItem]);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchFactors();
        setFactorsOptions(Array.isArray(list) ? list : []);
      } catch { /* not critical */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchAdditionalCosts();
        setAdditionalCostsOptions(Array.isArray(list) ? list : []);
      } catch { /* not critical */ }
    })();
  }, []);

  const showSaved = (msg) => {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(""), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    setSavedMsg("");
    try {
      const materialCostNum = materialCost === "" ? null : Number(materialCost);
      const laborHoursNum = laborHours === "" ? null : Number(laborHours);
      const multiplierNum = multiplierOverride === "" ? null : Number(multiplierOverride);
      const payload = {
        name,
        description: htmlToMarkdown(description),
        unit: unit || undefined,
        materialCost: materialCostNum != null && !Number.isNaN(materialCostNum) ? materialCostNum : undefined,
        laborHours: laborHoursNum != null && !Number.isNaN(laborHoursNum) ? laborHoursNum : undefined,
        multiplierOverride: multiplierNum != null && !Number.isNaN(multiplierNum) ? multiplierNum : undefined,
        subItem,
        requiresInfo,
        factors: factors.map((f) => f.id).filter((id) => id != null),
        additional_costs: additionalCosts.map((c) => c.id).filter((id) => id != null),
        ...extraFields,
      };
      await updatePayloadItem(itemId, payload);
      setDirty(false);
      const categoryId = item?.category?.id ?? item?.category;
      if (categoryId != null) invalidatePayloadCache(categoryId);
      showSaved("Saved successfully");
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const setExtraField = useCallback((key, value) => {
    setExtraFields((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  function fieldLabel(key) {
    return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validationErr = validateMediaFile(file);
    if (validationErr) { setError(validationErr); return; }
    setUploading(true);
    setError(null);
    try {
      await uploadItemMedia(itemId, file);
      const categoryId = item?.category?.id ?? item?.category;
      if (categoryId != null) invalidatePayloadCache(categoryId);
      await loadItem();
    } catch (err) { setError(err.message); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDetachMedia = async (mediaId) => {
    if (!confirm("Remove this image from the item? (The image won't be deleted from the system)")) return;
    setDetaching(mediaId);
    setError(null);
    try {
      await detachItemMedia(itemId, mediaId);
      const categoryId = item?.category?.id ?? item?.category;
      if (categoryId != null) invalidatePayloadCache(categoryId);
      await loadItem();
    } catch (err) { setError(err.message); }
    finally { setDetaching(null); }
  };

  if (loading) return <main className="page"><p>Loading item...</p></main>;

  if (error && !item) {
    return (
      <main className="page">
        {!isModal && (
          <button className="btn btn--link" onClick={() => navigate("/items", { state: { workAreaId: location.state?.fromWorkAreaId, categoryId: location.state?.fromCategoryId } })}>Back</button>
        )}
        <div className="error-banner">
          <span className="error-banner__icon">!</span>
          <span className="error-banner__message">{error}</span>
        </div>
      </main>
    );
  }

  const currentMedia = mediaList[selectedMedia] || null;
  const currentImage = currentMedia?.url || null;
  const currentIsVideo = currentMedia?.isVideo || false;
  const categoryName = item?.category?.title || item?.category?.name || "";

  // ── Image gallery panel (right side) ──
  const imagePanel = (
    <>
      <div className="idf__live-preview">
        {currentImage ? (
          currentIsVideo ? (
            <video
              src={currentImage}
              className="idf__live-preview__img"
              controls
            />
          ) : (
            <img
              className="idf__live-preview__img"
              src={currentImage}
              alt={name || "Item"}
            />
          )
        ) : (
          <div className="ew-preview__empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="48" height="48">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 21h10.5A2.25 2.25 0 0019.5 18.75V6.75A2.25 2.25 0 0017.25 4.5H6.75A2.25 2.25 0 004.5 6.75v12A2.25 2.25 0 006.75 21z" />
            </svg>
            <p>No image yet</p>
          </div>
        )}

        <button className="idf__live-upload-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
          {uploading ? "Uploading…" : "Upload Image"}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={handleUpload} />
      </div>

      {mediaList.length > 1 && (
        <div className="idf__thumbstrip">
          {mediaList.map((m, i) => (
            <div key={m.id || i} className="idf__thumb-wrap">
              {m.isVideo ? (
                <div
                  className={`idf__thumb--video ${selectedMedia === i ? "idf__thumb--active" : ""}`}
                  onClick={() => setSelectedMedia(i)}
                >▶</div>
              ) : (
                <img
                  className={`idf__thumb ${selectedMedia === i ? "idf__thumb--active" : ""}`}
                  src={m.thumbUrl}
                  alt=""
                  onClick={() => setSelectedMedia(i)}
                  onError={(e) => { e.target.src = m.url; }}
                />
              )}
              <button
                className="idf__thumb-remove"
                onClick={() => handleDetachMedia(m.id)}
                disabled={detaching === m.id}
                title="Remove image"
              >×</button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  // ── Form sections ──
  const formSections = (
    <div className="idf">

      <div className="idf__section">
        <label className="idf__label">Description</label>
        <RichTextEditor content={description} onChange={(html) => { setDescription(html); setDirty(true); }} />
      </div>

      <div className="idf__section">
        <p className="idf__section-title">Pricing</p>
        <div className="idf__grid2">
          <div>
            <label className="idf__label">Material Cost</label>
            <div className="idf__input-wrap idf__input-wrap--prefix">
              <span className="idf__prefix">$</span>
              <input className="idf__input" type="number" step="any" min="0" value={materialCost} placeholder="0.00"
                onChange={(e) => { setMaterialCost(e.target.value); setDirty(true); }} />
            </div>
          </div>
          <div>
            <label className="idf__label">Labor Hours</label>
            <input className="idf__input" type="number" step="any" min="0" value={laborHours} placeholder="0"
              onChange={(e) => { setLaborHours(e.target.value); setDirty(true); }} />
          </div>
          <div>
            <label className="idf__label">Unit</label>
            <select className="idf__input idf__select" value={unit}
              onChange={(e) => { setUnit(e.target.value); setDirty(true); }}>
              {UNIT_OPTIONS.map((opt) => (
                <option key={opt || "__empty__"} value={opt}>{opt || "— Select —"}</option>
              ))}
              {unit && !UNIT_OPTIONS.includes(unit) && <option value={unit}>{unit}</option>}
            </select>
          </div>
          <div>
            <label className="idf__label">Multiplier Override</label>
            <input className="idf__input" type="number" step="any" value={multiplierOverride} placeholder="—"
              onChange={(e) => { setMultiplierOverride(e.target.value); setDirty(true); }} />
          </div>
        </div>
      </div>

      <div className="idf__section">
        <p className="idf__section-title">Flags</p>
        <div className="idf__toggles">
          <label className="idf__toggle">
            <span className="idf__toggle-track">
              <input type="checkbox" checked={subItem} onChange={(e) => { setSubItem(e.target.checked); setDirty(true); }} />
              <span className="idf__toggle-thumb" />
            </span>
            <span className="idf__toggle-label">Sub Item</span>
          </label>
          <label className="idf__toggle">
            <span className="idf__toggle-track">
              <input type="checkbox" checked={requiresInfo} onChange={(e) => { setRequiresInfo(e.target.checked); setDirty(true); }} />
              <span className="idf__toggle-thumb" />
            </span>
            <span className="idf__toggle-label">Requires Info</span>
          </label>
        </div>
      </div>

      {(factors.length > 0 || factorsOptions.length > 0) && (
        <div className="idf__section">
          <p className="idf__section-title">Factors</p>
          <div className="idf__chips">
            {factors.map((f) => (
              <span key={f.id} className="idf__chip">
                {f.label}
                <button type="button" className="idf__chip-remove"
                  onClick={() => { setFactors((prev) => prev.filter((x) => x.id !== f.id)); setDirty(true); }}>×</button>
              </span>
            ))}
          </div>
          {factorsOptions.length > 0 && (
            <select className="idf__input idf__select idf__select--add" value=""
              onChange={(e) => {
                const id = e.target.value === "" ? null : Number(e.target.value);
                e.target.value = "";
                if (id != null && !factors.some((c) => c.id === id)) {
                  const opt = factorsOptions.find((a) => a.id === id);
                  setFactors((prev) => [...prev, { id, label: opt ? opt.label : `ID: ${id}` }]);
                  setDirty(true);
                }
              }}>
              <option value="">+ Add factor…</option>
              {factorsOptions.filter((a) => !factors.some((c) => c.id === a.id)).map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {(additionalCosts.length > 0 || additionalCostsOptions.length > 0) && (
        <div className="idf__section">
          <p className="idf__section-title">Additional Costs</p>
          <div className="idf__chips">
            {additionalCosts.map((c) => (
              <span key={c.id} className="idf__chip idf__chip--cost">
                {c.label}
                <button type="button" className="idf__chip-remove"
                  onClick={() => { setAdditionalCosts((prev) => prev.filter((x) => x.id !== c.id)); setDirty(true); }}>×</button>
              </span>
            ))}
          </div>
          {additionalCostsOptions.length > 0 && (
            <select className="idf__input idf__select idf__select--add" value=""
              onChange={(e) => {
                const id = e.target.value === "" ? null : Number(e.target.value);
                e.target.value = "";
                if (id != null && !additionalCosts.some((c) => c.id === id)) {
                  const opt = additionalCostsOptions.find((a) => a.id === id);
                  setAdditionalCosts((prev) => [...prev, { id, label: opt ? opt.label : `ID: ${id}` }]);
                  setDirty(true);
                }
              }}>
              <option value="">+ Add cost…</option>
              {additionalCostsOptions.filter((a) => !additionalCosts.some((c) => c.id === a.id)).map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {Object.keys(extraFields).length > 0 && (
        <div className="idf__section">
          <p className="idf__section-title">Other Fields</p>
          <div className="idf__grid2">
            {Object.entries(extraFields).map(([key, value]) => (
              <div key={key}>
                <label className="idf__label">{fieldLabel(key)}</label>
                {typeof value === "boolean" ? (
                  <label className="idf__toggle">
                    <span className="idf__toggle-track">
                      <input type="checkbox" checked={!!extraFields[key]} onChange={(e) => setExtraField(key, e.target.checked)} />
                      <span className="idf__toggle-thumb" />
                    </span>
                  </label>
                ) : (
                  <input className="idf__input"
                    type={typeof value === "number" ? "number" : "text"}
                    step={typeof value === "number" ? "any" : undefined}
                    value={extraFields[key] ?? ""}
                    onChange={(e) => setExtraField(key, typeof value === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(item?.createdAt || item?.updatedAt) && (
        <div className="idf__meta">
          {item?.createdAt && <span>Created {new Date(item.createdAt).toLocaleDateString()}</span>}
          {item?.updatedAt && <span>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>}
        </div>
      )}
    </div>
  );

  return (
    <main className="page">
      {!isModal && (
        <button className="btn btn--link" onClick={() => navigate("/items", { state: { workAreaId: location.state?.fromWorkAreaId, categoryId: location.state?.fromCategoryId } })}>← Back</button>
      )}

      {error && (
        <div className="error-banner" style={{ marginBottom: 16 }}>
          <span className="error-banner__icon">!</span>
          <span className="error-banner__message">{error}</span>
        </div>
      )}

      {/* ════════ ITEM DETAIL ════════ */}
      <div className={isModal ? "idf-modal-layout" : "idf-page-layout"}>

        {/* Left: form */}
        <div className="idf-modal-layout__form">
          <div className="idf__item-header">
            {categoryName && <p className="idf__category">{categoryName}</p>}
            <input
              className="idf__name-input"
              type="text"
              value={name}
              placeholder="Item name"
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
            />
          </div>
          {formSections}
        </div>

        {/* Right: image gallery */}
        <div className="idf-modal-layout__image">
          {imagePanel}
        </div>
      </div>

      {/* ════════ SAVE BAR ════════ */}
      <div className="idf__save-bar">
        <button className="idf__save-btn" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : dirty ? "Save Changes" : "Saved"}
        </button>
        {savedMsg && <span className="idf__saved-msg">✓ {savedMsg}</span>}
        {error && <span className="idf__error-msg">⚠ {error}</span>}
      </div>
    </main>
  );
}
