import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getOrg, deleteOrg, deployOrg, planOrgDeployment, seedDemoData, planDemoData, generateOrgLogo, setLogoPlaceholder, cloneToReal, addWorkArea, generateWorkAreaCatalog, exportDeployUsers, getVideoProviders, listOrgVideos, generateOrgVideo, previewOrgVideoPrompt, deleteOrgVideo } from "../services/orgApi.js";
import { getMenaiaSettings, hasMenaiaSettings, hasAdminAuthSettings } from "../services/menaiaSettings.js";

function StatBadge({ label, value }) {
  return (
    <div className="stat-badge">
      <span className="stat-badge__value">{value}</span>
      <span className="stat-badge__label">{label}</span>
    </div>
  );
}

function SectionCard({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="section-card">
      <button className="section-card__header" onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span className="section-card__chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="section-card__body">{children}</div>}
    </div>
  );
}

function BranchSection({ branches }) {
  return (
    <SectionCard title={`Branches (${branches.length})`}>
      {branches.map((b) => (
        <div key={b.name} className="detail-row">
          <div className="detail-row__title">{b.name}</div>
          <div className="detail-row__sub">{b.address}</div>
          <div className="detail-row__meta">
            {b.phone && <span>{b.phone}</span>}
            <span>{b.timezone}</span>
            {b.contractorLicense && <span>License: {b.contractorLicense}</span>}
          </div>
          {b.branchFinancingTerms?.length > 0 && (
            <div className="detail-row__tags">
              {b.branchFinancingTerms.map((t) => (
                <span key={t.name} className="tag">{t.name}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </SectionCard>
  );
}

const WAB_LOG_ICONS = { running: "⟳", done: "✓", failed: "✗" };

// Multi-industry work-area builder: add industries and generate each work area's
// catalog (categories + items) one at a time. Shown only for multi-industry orgs.
function WorkAreaBuilderSection({ org, onChanged }) {
  const workAreas = org.resources.workAreas || [];
  const [newIndustry, setNewIndustry] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [genState, setGenState] = useState({});          // { [name]: { running, log, result } }
  const [industryOverride, setIndustryOverride] = useState({});
  const [cats, setCats] = useState(7);
  const [items, setItems] = useState(6);

  const anyRunning = Object.values(genState).some((g) => g?.running);

  async function handleAdd() {
    const name = newIndustry.trim();
    if (!name) return;
    setAdding(true); setAddError("");
    try { await addWorkArea(org.slug, name); setNewIndustry(""); onChanged?.(); }
    catch (e) { setAddError(e.message); }
    finally { setAdding(false); }
  }

  async function handleGenerate(wa) {
    setGenState((s) => ({ ...s, [wa.name]: { running: true, log: [], result: null } }));
    try {
      const res = await generateWorkAreaCatalog(org.slug, {
        workArea: wa.name,
        industry: (industryOverride[wa.name] || wa.name).trim(),
        categoriesPerIndustry: Number(cats) || 7,
        itemsPerCategory: Number(items) || 6,
      }, {
        onStep: (entry) => setGenState((s) => ({
          ...s, [wa.name]: { running: true, log: [...(s[wa.name]?.log || []), entry], result: null },
        })),
      });
      setGenState((s) => ({
        ...s,
        [wa.name]: {
          running: false,
          log: res.log || s[wa.name]?.log || [],
          result: res.success
            ? { success: true, addedCats: res.addedCats, addedItems: res.addedItems }
            : { success: false, error: res.error || "Generation failed" },
        },
      }));
      if (res.success) onChanged?.();
    } catch (e) {
      setGenState((s) => ({ ...s, [wa.name]: { running: false, log: s[wa.name]?.log || [], result: { success: false, error: e.message } } }));
    }
  }

  return (
    <SectionCard title={`Industries / Work Areas (${workAreas.length})`}>
      <div className="wab">
        <div className="deploy-panel__note">
          One work area per industry. Generate each work area's catalog (categories + items) —
          you can override the industry the AI generates for. Images come later via the bulk flow.
        </div>
        <div className="deploy-demo__controls">
          <label className="form-label deploy-demo__field">
            Categories
            <input type="number" min="3" max="12" className="form-input deploy-demo__num" value={cats} onChange={(e) => setCats(e.target.value)} disabled={anyRunning} />
          </label>
          <label className="form-label deploy-demo__field">
            Items / category
            <input type="number" min="3" max="12" className="form-input deploy-demo__num" value={items} onChange={(e) => setItems(e.target.value)} disabled={anyRunning} />
          </label>
        </div>

        {workAreas.map((wa) => {
          const g = genState[wa.name] || {};
          const count = wa.categories.length;
          return (
            <div key={wa.name} className="wab__row">
              <div className="wab__head">
                <strong>{wa.name}</strong>
                <span className="wab__count">{count} categor{count === 1 ? "y" : "ies"}</span>
              </div>
              <div className="wab__actions">
                <input
                  className="form-input"
                  placeholder={`Industry (default: ${wa.name})`}
                  value={industryOverride[wa.name] ?? ""}
                  onChange={(e) => setIndustryOverride((s) => ({ ...s, [wa.name]: e.target.value }))}
                  disabled={g.running}
                />
                <button className="btn btn--deploy" onClick={() => handleGenerate(wa)} disabled={g.running || anyRunning}>
                  {g.running ? "Generating…" : count > 0 ? "Add more" : "Generate catalog"}
                </button>
              </div>
              {g.log?.length > 0 && (
                <div className="deploy-log">
                  {g.log.map((e, i) => (
                    <div key={i} className={`deploy-log__entry deploy-log__entry--${e.status}`}>
                      <span className="deploy-log__icon">{WAB_LOG_ICONS[e.status] || "•"}</span>
                      <span className="deploy-log__name">{e.name}</span>
                      {e.detail && <span className="deploy-log__detail">{e.detail}</span>}
                    </div>
                  ))}
                </div>
              )}
              {g.result && (
                <div className={`deploy-result ${g.result.success ? "deploy-result--success" : "deploy-result--error"}`}>
                  {g.result.success ? `✓ +${g.result.addedCats} categories, +${g.result.addedItems} items` : `✗ ${g.result.error}`}
                </div>
              )}
            </div>
          );
        })}

        <div className="wab__add">
          <input
            className="form-input"
            placeholder="Add an industry (new work area)…"
            value={newIndustry}
            onChange={(e) => setNewIndustry(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            disabled={adding}
          />
          <button className="btn btn--secondary" onClick={handleAdd} disabled={adding || !newIndustry.trim()}>
            {adding ? "Adding…" : "+ Add industry"}
          </button>
        </div>
        {addError && <div className="deploy-result deploy-result--error">{addError}</div>}
      </div>
    </SectionCard>
  );
}

function CatalogSection({ resources }) {
  const { categories, workAreas, factors, additionalCosts, multiplierRanges } = resources;
  const totalItems = categories.reduce((s, c) => s + c.items.length, 0);
  return (
    <SectionCard title={`Catalog — ${categories.length} categories, ${totalItems} items`}>
      <div className="catalog-grid">
        {categories.map((cat) => (
          <div key={cat.name} className="catalog-cat">
            <div className="catalog-cat__name">{cat.name}</div>
            <div className="catalog-cat__count">{cat.items.length} items</div>
            <div className="catalog-cat__items">
              {cat.items.slice(0, 4).map((item) => (
                <div key={item.name} className="catalog-item">
                  <span className="catalog-item__name">{item.name}</span>
                  <span className="catalog-item__meta">{item.unit} · ${item.materialCost}</span>
                </div>
              ))}
              {cat.items.length > 4 && (
                <div className="catalog-item catalog-item--more">+{cat.items.length - 4} more</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="subsection-grid">
        <div className="subsection">
          <h4>Work Areas ({workAreas.length})</h4>
          {workAreas.map((wa) => (
            <div key={wa.name} className="pill">{wa.name}</div>
          ))}
        </div>
        <div className="subsection">
          <h4>Factors ({factors.length})</h4>
          {factors.map((f) => (
            <div key={f.name} className="pill">{f.name} ×{f.factor}</div>
          ))}
        </div>
        <div className="subsection">
          <h4>Multiplier Ranges ({multiplierRanges.length})</h4>
          {multiplierRanges.map((r) => (
            <div key={r.name} className="pill">{r.name} ({r.lowestMultiple}–{r.highestMultiple}×)</div>
          ))}
        </div>
        {additionalCosts?.length > 0 && (
          <div className="subsection">
            <h4>Additional Costs ({additionalCosts.length})</h4>
            {additionalCosts.map((c) => (
              <div key={c.name} className="pill">{c.name} ${c.cost}</div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function UsersSection({ users, slug }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const roleGroups = users.reduce((acc, u) => {
    if (!acc[u.role]) acc[u.role] = [];
    acc[u.role].push(u);
    return acc;
  }, {});

  async function handleExport() {
    setExporting(true);
    setExportError("");
    try {
      await exportDeployUsers(slug);
    } catch (e) {
      setExportError(e.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <SectionCard title={`Users (${users.length})`}>
      <div className="users-toolbar">
        <button
          className="btn btn--secondary btn--sm"
          onClick={handleExport}
          disabled={exporting || users.length === 0}
          title="Download an .xlsx of the deployed users (email, password, role, branches)"
        >
          {exporting ? "Exporting…" : "⬇ Export users Excel"}
        </button>
      </div>
      {exportError && <div className="deploy-result deploy-result--error">{exportError}</div>}
      <div className="users-grid">
        {Object.entries(roleGroups).map(([role, roleUsers]) => (
          <div key={role} className="user-role-group">
            <div className="user-role-group__label">{role} ({roleUsers.length})</div>
            {roleUsers.map((u) => (
              <div key={u.email} className="user-row">
                <span className="user-row__name">{u.name}</span>
                <span className="user-row__email">{u.email}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function ImagesSection({ org }) {
  const [expandedCat, setExpandedCat] = useState(null);
  const [preview, setPreview] = useState(null);

  const totalItems = org.resources.categories.reduce((s, c) => s + c.items.length, 0);
  const itemsWithImages = org.resources.categories.reduce(
    (s, c) => s + c.items.filter((i) => i.imageUrl).length,
    0
  );
  const itemsWithLogo = org.resources.categories.reduce(
    (s, c) => s + c.items.filter((i) => i.imageUrlWithLogo).length,
    0
  );
  const coverage = totalItems > 0 ? Math.round((itemsWithImages / totalItems) * 100) : 0;

  // Group categories by work area — each category assigned to first work area that claims it.
  const workAreas = org.resources.workAreas || [];
  const assigned = new Set();
  const groups = workAreas.map((wa) => {
    const cats = (wa.categories || [])
      .map((name) => org.resources.categories.find((c) => c.name === name))
      .filter(Boolean)
      .filter((c) => !assigned.has(c.name));
    cats.forEach((c) => assigned.add(c.name));
    return { name: wa.name, cats };
  }).filter((g) => g.cats.length > 0);

  // Unassigned categories go in a final group with no label
  const unassigned = org.resources.categories.filter((c) => !assigned.has(c.name));
  if (unassigned.length > 0) groups.push({ name: null, cats: unassigned });

  function CatCard({ cat }) {
    const withImages = cat.items.filter((i) => i.imageUrl).length;
    const catCoverage = cat.items.length > 0 ? (withImages / cat.items.length) * 100 : 0;
    const isFull = withImages === cat.items.length;
    const isEmpty = withImages === 0;
    const isOpen = expandedCat === cat.name;
    return (
      <div className={`img-cat-card ${isEmpty ? "img-cat-card--empty" : ""} ${isOpen ? "img-cat-card--open" : ""}`}>
        <button
          className="img-cat-card__toggle img-cat-card__header"
          onClick={() => setExpandedCat(isOpen ? null : cat.name)}
        >
          <span className="img-cat-card__chevron">{isOpen ? "▾" : "▸"}</span>
          <span className="img-cat-card__name">{cat.name}</span>
          <span className="img-cat-card__meta">
            <span className="img-cat-card__minibar" aria-hidden="true">
              <span
                className={`img-cat-card__minibar-fill ${isFull ? "img-cat-card__minibar-fill--full" : ""}`}
                style={{ width: `${catCoverage}%` }}
              />
            </span>
            <span className={`img-cat-card__count ${isFull ? "img-cat-card__count--full" : isEmpty ? "img-cat-card__count--zero" : ""}`}>
              {withImages}/{cat.items.length}
            </span>
          </span>
        </button>
        {isOpen && (
          <div className="img-cat-card__grid">
            {cat.items.map((item) =>
              item.imageUrl ? (
                <button
                  key={item.name}
                  type="button"
                  className="img-thumb img-thumb--has"
                  title={`${item.name} — click to preview`}
                  onClick={() => setPreview(item)}
                >
                  <img
                    src={item.imageUrlWithLogo || item.imageUrl}
                    alt={item.name}
                    className="img-thumb__img"
                    loading="lazy"
                    onError={(e) => {
                      // Fall back to the base image if the logo version fails to load.
                      if (item.imageUrlWithLogo && e.currentTarget.src !== item.imageUrl) {
                        e.currentTarget.src = item.imageUrl;
                      }
                    }}
                  />
                  {item.imageUrlWithLogo && (
                    <span className="img-thumb__logo-badge" title="Logo applied">◆ Logo</span>
                  )}
                  <div className="img-thumb__label">{item.name}</div>
                </button>
              ) : (
                <div key={item.name} className="img-thumb img-thumb--empty" title={item.name}>
                  <span className="img-thumb__empty-name">{item.name}</span>
                </div>
              )
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <SectionCard title="Item Images">
      <div className="img-section">

        {/* Summary + progress bar */}
        <div className="img-summary">
          <span className="img-summary__text">
            <strong>{itemsWithImages}</strong> of <strong>{totalItems}</strong> items have images
            {itemsWithLogo > 0 && (
              <span className="img-summary__logo">
                <span className="img-summary__logo-dot">◆</span>
                {itemsWithLogo} with logo
              </span>
            )}
          </span>
          <span className={`img-cat-card__count ${coverage === 100 ? "img-cat-card__count--full" : ""}`}>
            {coverage}%
          </span>
        </div>
        <div className="img-progress-bar">
          <div className="img-progress-bar__fill" style={{ width: `${coverage}%` }} />
        </div>

        {/* Groups by work area */}
        <div className="img-groups">
          {groups.map((group) => (
            <div key={group.name ?? "__ungrouped"} className="img-group">
              {group.name && (
                <div className="img-group__label">{group.name}</div>
              )}
              <div className="img-categories">
                {group.cats.map((cat) => <CatCard key={cat.name} cat={cat} />)}
              </div>
            </div>
          ))}
        </div>

        <p className="img-section__hint">
          Generate images from <strong>Settings → Price Book</strong>.
        </p>
      </div>

      {preview && (
        <ImagePreviewModal item={preview} onClose={() => setPreview(null)} />
      )}
    </SectionCard>
  );
}

function ImagePreviewModal({ item, onClose }) {
  const hasLogo = Boolean(item.imageUrlWithLogo);
  // Default to the logo version when it exists — that's the deployment-ready image.
  const [variant, setVariant] = useState(hasLogo ? "logo" : "original");

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const src = variant === "logo" && hasLogo ? item.imageUrlWithLogo : item.imageUrl;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="img-preview" onClick={(e) => e.stopPropagation()}>
        <div className="img-preview__header">
          <h3 className="img-preview__title">{item.name}</h3>
          <button className="modal-box__close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {hasLogo && (
          <div className="img-preview__toggle">
            <button
              className={`img-preview__toggle-btn ${variant === "original" ? "is-active" : ""}`}
              onClick={() => setVariant("original")}
            >
              Original
            </button>
            <button
              className={`img-preview__toggle-btn ${variant === "logo" ? "is-active" : ""}`}
              onClick={() => setVariant("logo")}
            >
              ◆ With Logo
            </button>
          </div>
        )}

        <div className="img-preview__stage">
          {/* Both variants stay mounted so toggling is instant (cached) and crossfades. */}
          <img
            src={item.imageUrl}
            alt={item.name}
            className={`img-preview__img ${variant === "original" || !hasLogo ? "is-shown" : ""}`}
          />
          {hasLogo && (
            <img
              src={item.imageUrlWithLogo}
              alt={`${item.name} with logo`}
              className={`img-preview__img ${variant === "logo" ? "is-shown" : ""}`}
            />
          )}
        </div>

        <div className="img-preview__footer">
          {hasLogo ? (
            <span className="img-preview__hint">
              Showing the {variant === "logo" ? "logo-branded" : "original"} image.
            </span>
          ) : (
            <span className="img-preview__hint">No logo version yet — apply a logo from Settings.</span>
          )}
          <a className="img-preview__open" href={src} target="_blank" rel="noreferrer">
            Open full size ↗
          </a>
        </div>
      </div>
    </div>
  );
}

const PROVIDER_LABEL = { openai: "Sora (OpenAI)", gemini: "Veo (Google)" };

// Rough per-second pricing (USD) for the cost estimate — approximate, provider
// pricing changes over time.
const PRICE_PER_SEC = {
  "sora-2": 0.10,
  "sora-2-pro": 0.30,
  "veo-3.1-generate-preview": 0.40,
  "veo-3.1-fast-generate-preview": 0.15,
  "veo-3.1-lite-generate-preview": 0.10,
};

function VideoSection({ org }) {
  const slug = org.slug;
  const [providers, setProviders] = useState(null);
  const [videos, setVideos] = useState([]);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [kind, setKind] = useState("company");
  const [orientation, setOrientation] = useState("landscape");
  const [seconds, setSeconds] = useState("8");   // Sora clip length
  const [segments, setSegments] = useState(1);   // Veo clips to stitch (8s each)
  const [silent, setSilent] = useState(true);
  const [pingPong, setPingPong] = useState(false); // seamless loop for landing bg
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);   // { message, progress }
  const [livePrompt, setLivePrompt] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    getVideoProviders().then((data) => {
      setProviders(data);
      // Default to the first configured provider.
      const firstAvail = ["openai", "gemini"].find((p) => data[p]?.available) || "openai";
      setProvider(firstAvail);
      setModel(data[firstAvail]?.models?.[0]?.id || "");
    }).catch((e) => setError(e.message));
    listOrgVideos(slug).then(setVideos).catch(() => {});
  }, [slug]);

  // Keep the model valid whenever the provider changes.
  useEffect(() => {
    if (!providers) return;
    const models = providers[provider]?.models || [];
    if (!models.find((m) => m.id === model)) setModel(models[0]?.id || "");
  }, [provider, providers]); // eslint-disable-line react-hooks/exhaustive-deps

  const anyConfigured = providers && (providers.openai?.available || providers.gemini?.available);

  // Total seconds + cost estimate for the current selection.
  const isVeo = provider === "gemini";
  const totalSeconds = isVeo ? segments * 8 : Number(seconds);   // billed length
  const finalSeconds = totalSeconds * (pingPong ? 2 : 1);        // playback length
  const perSec = PRICE_PER_SEC[model] ?? 0.15;
  const costEstimate = (perSec * totalSeconds).toFixed(2);

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setLivePrompt("");
    setStatus({ message: "Starting…", progress: 0 });
    try {
      const video = await generateOrgVideo(slug, { provider, model, kind, orientation, seconds, segments: isVeo ? segments : 1, silent, loop: pingPong ? "boomerang" : "none", extra }, {
        onEvent: (data) => {
          if (data.type === "status") setStatus({ message: data.message, progress: 0 });
          else if (data.type === "prompt") setLivePrompt(data.prompt);
          else if (data.type === "progress") {
            const secs = Math.round((data.elapsedMs || 0) / 1000);
            setStatus({ message: `Rendering… ${data.progress || 0}% (${secs}s elapsed)`, progress: data.progress || 0 });
          }
        },
      });
      setVideos((prev) => [video, ...prev]);
      setStatus(null);
    } catch (e) {
      setError(e.message);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    setStatus({ message: "Writing the prompt from org context…", progress: 0 });
    try {
      const prompts = await previewOrgVideoPrompt(slug, { provider, model, kind, orientation, seconds, segments: isVeo ? segments : 1, extra });
      setLivePrompt(prompts.join("\n\n— — —\n\n"));
    } catch (e) {
      setError(e.message);
    } finally {
      setStatus(null);
      setBusy(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this video?")) return;
    try {
      const next = await deleteOrgVideo(slug, id);
      setVideos(next);
    } catch (e) {
      setError(e.message);
    }
  }

  const models = (providers && providers[provider]?.models) || [];

  return (
    <SectionCard title="Preview Videos">
      <div className="video-section">
        <p className="video-section__intro">
          Generate a short promo/preview clip that presents <strong>{org.name}</strong> or the{" "}
          <strong>{org.industry || "industry"}</strong>. The prompt is written automatically from this org's
          context and visual style. Rendering takes a few minutes and is billed per video by the provider.
        </p>

        {providers && !anyConfigured && (
          <div className="video-warn">
            No video provider is configured. Add an <code>OPENAI_API_KEY</code> (Sora) or{" "}
            <code>GEMINI_API_KEY</code> (Veo) to the server env.
          </div>
        )}

        {anyConfigured && (
          <div className="video-form">
            <div className="video-form__row">
              <label className="video-field">
                <span className="video-field__label">Provider</span>
                <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={busy}>
                  {["openai", "gemini"].map((p) => (
                    <option key={p} value={p} disabled={!providers[p]?.available}>
                      {PROVIDER_LABEL[p]}{providers[p]?.available ? "" : " — no key"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="video-field">
                <span className="video-field__label">Model</span>
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label} — {m.note}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="video-form__row">
              <label className="video-field">
                <span className="video-field__label">Subject</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
                  <option value="company">This company</option>
                  <option value="industry">The industry</option>
                </select>
              </label>

              <label className="video-field">
                <span className="video-field__label">Orientation</span>
                <select value={orientation} onChange={(e) => setOrientation(e.target.value)} disabled={busy}>
                  <option value="landscape">Landscape 16:9</option>
                  <option value="portrait">Portrait 9:16</option>
                </select>
              </label>

              {provider === "openai" ? (
                <label className="video-field">
                  <span className="video-field__label">Length</span>
                  <select value={seconds} onChange={(e) => setSeconds(e.target.value)} disabled={busy}>
                    <option value="4">4s</option>
                    <option value="8">8s</option>
                    <option value="12">12s</option>
                  </select>
                </label>
              ) : (
                <label className="video-field">
                  <span className="video-field__label">Length</span>
                  <select value={segments} onChange={(e) => setSegments(Number(e.target.value))} disabled={busy}>
                    <option value={1}>8s (1 clip)</option>
                    <option value={2}>16s (2×8, stitched)</option>
                    <option value={3}>24s (3×8, stitched)</option>
                  </select>
                </label>
              )}
            </div>

            <label className="video-check">
              <input type="checkbox" checked={silent} onChange={(e) => setSilent(e.target.checked)} disabled={busy} />
              <span>Silent — remove audio/voice (recommended for landing pages)</span>
            </label>

            <label className="video-check">
              <input type="checkbox" checked={pingPong} onChange={(e) => setPingPong(e.target.checked)} disabled={busy} />
              <span>Seamless loop — ping-pong (plays forward then reverse, no jump; doubles length)</span>
            </label>

            <label className="video-field">
              <span className="video-field__label">Extra direction (optional)</span>
              <textarea
                className="video-textarea"
                rows={2}
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                disabled={busy}
                placeholder="e.g. drone shot over the neighborhood, golden hour, focus on the crew loading the truck"
              />
            </label>

            <div className="video-generate">
              <button className="btn btn--primary" onClick={handleGenerate} disabled={busy || !model}>
                {busy ? "Generating…" : "Generate video"}
              </button>
              <button className="btn btn--secondary" onClick={handlePreview} disabled={busy}>
                Preview prompt
              </button>
              <span className="video-estimate">
                ≈ ${costEstimate} · plays {finalSeconds}s{isVeo && segments > 1 ? ` (${segments} clips)` : ""}{pingPong ? " ↔ loop" : ""}
                <span className="video-estimate__note"> · estimate</span>
              </span>
            </div>
          </div>
        )}

        {status && (
          <div className="video-progress">
            <div className="video-progress__msg"><span className="spinner spinner--sm" /> {status.message}</div>
            <div className="img-progress-bar">
              <div className="img-progress-bar__fill" style={{ width: `${status.progress}%` }} />
            </div>
          </div>
        )}

        {livePrompt && (
          <div className="video-prompt">
            <span className="video-prompt__label">Prompt</span>
            <p className="video-prompt__text">{livePrompt}</p>
          </div>
        )}

        {error && <div className="video-warn video-warn--error">{error}</div>}

        {videos.length > 0 && (
          <div className="video-gallery">
            {videos.map((v) => (
              <div key={v.id} className="video-card">
                <video className="video-card__player" src={v.url} controls loop muted playsInline preload="metadata" />
                <div className="video-card__meta">
                  <span className="video-card__title">{v.title}</span>
                  <span className="video-card__badge">
                    {PROVIDER_LABEL[v.provider] || v.provider} · {v.model}
                    {v.durationSec ? ` · ${v.durationSec}s` : ""}
                    {v.segments > 1 ? ` · ${v.segments} clips` : ""}
                    {v.silent ? " · muted" : ""}
                  </span>
                </div>
                <div className="video-card__actions">
                  <a className="video-card__link" href={v.url} target="_blank" rel="noreferrer">Open ↗</a>
                  <button className="video-card__del" onClick={() => handleDelete(v.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function DeploySection({ slug, status, onDeployed }) {
  const navigate = useNavigate();
  const [planning, setPlanning] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [plan, setPlan] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [log, setLog] = useState([]);
  const [result, setResult] = useState(null);
  const logRef = useRef(null);

  // Auth mode for the deploy: "service" (service-account key) or "user" (real
  // org admin via Supabase JWT). User mode gets around the service account's
  // missing `create Item` ability (Menaia migration gap).
  const [deployMode, setDeployMode] = useState("service");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // Post-deploy demo-data population (avatars + leads) — dry run → confirm → run.
  const [leadsPerBranch, setLeadsPerBranch] = useState(5);
  const [includeAvatars, setIncludeAvatars] = useState(true);
  const [seedPlanning, setSeedPlanning] = useState(false);
  const [seedPlan, setSeedPlan] = useState(null);
  const [seedConfirmation, setSeedConfirmation] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [seedLog, setSeedLog] = useState([]);
  const [seedResult, setSeedResult] = useState(null);
  const seedLogRef = useRef(null);

  // Keep the streaming deploy log scrolled to the newest entry.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);
  useEffect(() => {
    if (seedLogRef.current) seedLogRef.current.scrollTop = seedLogRef.current.scrollHeight;
  }, [seedLog]);

  // Credentials come from the Settings page (browser → request headers), so the
  // deploy flow no longer prompts for them.
  const configured = hasMenaiaSettings();
  const adminAuthConfigured = hasAdminAuthSettings();
  const { url: menaiaUrl } = getMenaiaSettings();
  // Demo data can run once the org has been deployed (this session or earlier).
  const deployed = status === "deployed" || result?.success;

  async function handleSeedPlan() {
    setSeedPlanning(true);
    setSeedPlan(null);
    setSeedConfirmation("");
    setSeedLog([]);
    setSeedResult(null);
    try {
      const plan = await planDemoData(slug, {
        leadsPerBranch: Number(leadsPerBranch) || 5,
        includeAvatars,
      });
      setSeedPlan(plan);
    } catch (e) {
      setSeedResult({ success: false, error: e.message });
    } finally {
      setSeedPlanning(false);
    }
  }

  async function handleSeedDemoData() {
    if (!seedPlan || seedConfirmation !== seedPlan.confirmation) return;
    setSeeding(true);
    setSeedLog([]);
    setSeedResult(null);
    try {
      const res = await seedDemoData(slug, {
        leadsPerBranch: Number(leadsPerBranch) || 5,
        includeAvatars,
        confirmation: seedConfirmation,
      }, {
        onStep: (entry) => setSeedLog((prev) => [...prev, entry]),
      });
      setSeedLog(res.log || []);
      setSeedResult(res.success
        ? { success: true, actions: res.actions || [] }
        : { success: false, error: res.error || "Demo data failed" });
    } catch (e) {
      setSeedResult({ success: false, error: e.message });
    } finally {
      setSeeding(false);
    }
  }

  const LOG_STATUS_ICONS = { running: "⟳", done: "✓", failed: "✗" };

  function options(extra = {}) {
    const auth = deployMode === "user"
      ? { deployMode: "user", adminEmail: adminEmail.trim(), adminPassword }
      : {};
    return { ...auth, ...extra };
  }

  async function handlePlan() {
    setPlanning(true);
    setPlan(null);
    setConfirmation("");
    setLog([]);
    setResult(null);
    try {
      setPlan(await planOrgDeployment(slug, options()));
    } catch (e) {
      setResult({ success: false, error: e.message });
    } finally {
      setPlanning(false);
    }
  }

  async function handleDeploy() {
    if (!plan || confirmation !== plan.confirmation) return;
    setDeploying(true);
    setLog([]);
    setResult(null);
    try {
      const res = await deployOrg(slug, options({
        expectedOrganizationId: plan.target.id,
        confirmation,
      }), {
        // Append each step as it streams in so the log updates live.
        onStep: (entry) => setLog((prev) => [...prev, entry]),
      });
      setLog(res.log || []);
      if (!res.success) {
        setResult({ success: false, error: res.error || "Deploy failed" });
        return;
      }
      setResult({ success: true, credentials: res.credentials || [] });
      onDeployed?.();
      // Brief pause so the final "complete" step is visible, then land on the
      // post-deploy page (results + Excel export) which reads the persisted log.
      setTimeout(() => navigate(`/orgs/${slug}/deploy-result`), 700);
    } catch (e) {
      setResult({ success: false, error: e.message });
    } finally {
      setDeploying(false);
    }
  }

  return (
    <SectionCard title="Deploy to attic-tech">
      <div className="deploy-panel">
        <div className="deploy-panel__note">
          Existing-org only. The dry run authenticates with the service-account API key (bound to one organization)
          and shows the planned upserts. Deployment never creates or deletes an organization.
        </div>

        {configured ? (
          <div className="deploy-panel__note">
            Using the Menaia credentials from <Link to="/settings">Settings</Link> — target <code>{menaiaUrl}</code>.
          </div>
        ) : (
          <div className="deploy-panel__note deploy-panel__note--warn">
            No Menaia credentials configured. Add your API key and base URL in <Link to="/settings">Settings</Link> first.
          </div>
        )}

        {/* Auth mode — service key vs a real org admin (JWT). Admin mode works
            around the service account's missing `create Item` ability. */}
        <div className="deploy-authmode">
          <label className="deploy-authmode__opt">
            <input type="radio" name="deployMode" checked={deployMode === "service"} onChange={() => setDeployMode("service")} disabled={planning || deploying} />
            Service key
          </label>
          <label className="deploy-authmode__opt">
            <input type="radio" name="deployMode" checked={deployMode === "user"} onChange={() => setDeployMode("user")} disabled={planning || deploying} />
            Admin user (JWT)
          </label>
        </div>
        {deployMode === "user" && (
          <div className="deploy-authmode__fields">
            <div className="deploy-panel__note">
              Signs in as a real org admin (needs the API URL + Supabase config from{" "}
              <Link to="/settings">Settings</Link>). Use this when the service key can't create items.
            </div>
            <div className="form-row">
              <label className="form-label">Admin email</label>
              <input className="form-input" type="email" placeholder="admin@your-org.com" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} disabled={planning || deploying} />
            </div>
            <div className="form-row">
              <label className="form-label">Admin password</label>
              <input className="form-input" type="password" placeholder="••••••••" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} disabled={planning || deploying} />
            </div>
          </div>
        )}

        <button
          className="btn btn--deploy"
          onClick={handlePlan}
          disabled={planning || deploying || (deployMode === "user" ? !(adminEmail.trim() && adminPassword && adminAuthConfigured) : !configured)}
        >
          {planning ? "Checking target…" : "Check target and dry run"}
        </button>

        {plan && (
          <div className="deploy-plan">
            <div className="deploy-plan__target">
              <strong>{plan.target.name}</strong>
              <span>ID: {plan.target.id}</span>
              <span>{plan.target.slug || plan.target.domain}</span>
            </div>
            {Object.values(plan.draftMatch).some((matches) => !matches) && (
              <div className="deploy-plan__warning">Draft name, slug, or domain does not fully match the authenticated organization. Verify the target carefully.</div>
            )}
            <div className="deploy-plan__totals">
              <span>{plan.totals.create} create</span>
              <span>{plan.totals.update} update</span>
              <span>{plan.totals.untouched} untouched</span>
            </div>
            <div className="deploy-plan__section-label">Price book &amp; config</div>
            <div className="deploy-plan__collections">
              {plan.collections.map((collection) => (
                <div key={collection.label}>
                  <strong>{collection.label}</strong>
                  <span>{collection.create.length} create / {collection.update.length} update / {collection.untouched} untouched</span>
                </div>
              ))}
            </div>
            {Array.isArray(plan.additional) && (
              <>
                <div className="deploy-plan__section-label">Onboarding, fleet &amp; media</div>
                <div className="deploy-plan__collections">
                  {plan.additional.map((row) => (
                    <div key={row.label}>
                      <strong>{row.label}{row.reconciled === false && <span className="deploy-plan__hint" title="Reconciled during deploy — existing records are skipped on apply"> *</span>}</strong>
                      <span>
                        {row.reconciled === false
                          ? `${row.create} create`
                          : `${row.create} create / ${row.untouched} untouched`}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="deploy-plan__deferred">
                  * Counts shown as planned creates; the deploy still skips any that already exist (or, for users, exist in the auth provider).
                </div>
              </>
            )}
            <div className="form-row">
              <label className="form-label">Type <code>{plan.confirmation}</code> to confirm this target</label>
              <input className="form-input form-input--mono" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={deploying} />
            </div>
            <button className="btn btn--deploy" onClick={handleDeploy} disabled={deploying || confirmation !== plan.confirmation}>
              {deploying ? "Deploying…" : status === "deployed" ? "Re-deploy to confirmed org" : "Deploy to confirmed org"}
            </button>
          </div>
        )}

        {log.length > 0 && (
          <div className="deploy-log" ref={logRef}>
            {log.map((entry, i) => (
              <div key={i} className={`deploy-log__entry deploy-log__entry--${entry.status}`}>
                <span className="deploy-log__icon">{LOG_STATUS_ICONS[entry.status] || "•"}</span>
                <span className="deploy-log__name">{entry.name}</span>
                {entry.detail && <span className="deploy-log__detail">{entry.detail}</span>}
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className={`deploy-result ${result.success ? "deploy-result--success" : "deploy-result--error"}`}>
            {result.success ? "✓ Deployed successfully" : `✗ ${result.error}`}
          </div>
        )}
        {result?.success && result.credentials?.length > 0 && (
          <div className="deploy-credentials">
            <strong>User credentials ({result.credentials.length}) — copy these now:</strong>
            <ul>
              {result.credentials.map((c) => (
                <li key={c.email}>
                  <code>{c.email}</code> / <code>{c.password}</code> — {c.role}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Post-deploy: populate demo data (avatars + leads) ──────────── */}
        <div className="deploy-demo">
          <div className="deploy-demo__divider" />
          <div className="deploy-demo__title">Populate demo data</div>
          <div className="deploy-panel__note">
            After deploying, seed the org with things to play with: user avatars and{" "}
            demo leads (with contacts) addressed in each branch's zone. Runs as a real
            org admin via the Payload &amp; avatar APIs.
          </div>

          {!deployed && (
            <div className="deploy-panel__note deploy-panel__note--warn">
              Deploy the org first — demo data is populated into the deployed organization.
            </div>
          )}
          <div className="deploy-demo__controls">
            <label className="form-label deploy-demo__field">
              Leads per branch
              <input
                type="number"
                min="0"
                max="50"
                className="form-input deploy-demo__num"
                value={leadsPerBranch}
                onChange={(e) => { setLeadsPerBranch(e.target.value); setSeedPlan(null); }}
                disabled={seeding || seedPlanning}
              />
            </label>
            <label className="deploy-demo__check">
              <input
                type="checkbox"
                checked={includeAvatars}
                onChange={(e) => { setIncludeAvatars(e.target.checked); setSeedPlan(null); }}
                disabled={seeding || seedPlanning}
              />
              Upload user avatars
            </label>
          </div>

          <button
            className="btn btn--deploy"
            onClick={handleSeedPlan}
            disabled={seedPlanning || seeding || !deployed || !configured}
          >
            {seedPlanning ? "Checking target…" : "Check target and dry run"}
          </button>

          {seedPlan && (
            <div className="deploy-plan">
              <div className="deploy-plan__target">
                <strong>{seedPlan.target.name}</strong>
                <span>ID: {seedPlan.target.id}</span>
                <span>{seedPlan.target.slug}</span>
                <span>{seedPlan.target.branchCount} branch(es)</span>
                {seedPlan.actor?.email && <span>as {seedPlan.actor.email}</span>}
              </div>
              <div className="deploy-plan__totals">
                <span>{seedPlan.avatars.willUpload} avatars</span>
                <span>{seedPlan.leads.willCreate} leads</span>
                <span>{seedPlan.leads.perBranch}/branch</span>
              </div>
              <div className="deploy-plan__collections">
                {seedPlan.leads.branches.map((b) => (
                  <div key={b.name}>
                    <strong>{b.name}</strong>
                    <span>
                      {b.willCreate} create
                      {b.already ? ` · ${b.already} already seeded` : ""}
                    </span>
                  </div>
                ))}
              </div>
              {seedPlan.avatars.willUpload === 0 && seedPlan.leads.willCreate === 0 ? (
                <div className="deploy-panel__note">Nothing to do — avatars and leads are already in place.</div>
              ) : (
                <>
                  <div className="form-row">
                    <label className="form-label">Type <code>{seedPlan.confirmation}</code> to confirm this target</label>
                    <input
                      className="form-input form-input--mono"
                      value={seedConfirmation}
                      onChange={(e) => setSeedConfirmation(e.target.value)}
                      disabled={seeding}
                    />
                  </div>
                  <button
                    className="btn btn--deploy"
                    onClick={handleSeedDemoData}
                    disabled={seeding || seedConfirmation !== seedPlan.confirmation}
                  >
                    {seeding ? "Populating…" : "Populate confirmed org"}
                  </button>
                </>
              )}
            </div>
          )}

          {seedLog.length > 0 && (
            <div className="deploy-log" ref={seedLogRef}>
              {seedLog.map((entry, i) => (
                <div key={i} className={`deploy-log__entry deploy-log__entry--${entry.status}`}>
                  <span className="deploy-log__icon">{LOG_STATUS_ICONS[entry.status] || "•"}</span>
                  <span className="deploy-log__name">{entry.name}</span>
                  {entry.detail && <span className="deploy-log__detail">{entry.detail}</span>}
                </div>
              ))}
            </div>
          )}

          {seedResult && (
            <div className={`deploy-result ${seedResult.success ? "deploy-result--success" : "deploy-result--error"}`}>
              {seedResult.success
                ? `✓ Seeded ${seedResult.actions.length} demo record(s)`
                : `✗ ${seedResult.error}`}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function DemoActions({ org, onChanged }) {
  const navigate = useNavigate();
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState("");
  const [logoVer, setLogoVer] = useState(Date.now());
  const [showConvert, setShowConvert] = useState(false);
  const [form, setForm] = useState({ companyName: "", companyWebsite: "", copyLogo: false });
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");

  async function handleSetPlaceholder() {
    setLogoBusy(true); setLogoMsg(""); setError("");
    try {
      await setLogoPlaceholder(org.slug);
      setLogoVer(Date.now());
      setLogoMsg("✓ 'Your Logo' placeholder set.");
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleGenerateLogo() {
    setLogoBusy(true); setLogoMsg(""); setError("");
    try {
      await generateOrgLogo(org.slug);
      setLogoVer(Date.now());
      setLogoMsg("✓ Fake AI logo generated.");
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setLogoBusy(false);
    }
  }

  async function handleConvert(e) {
    e.preventDefault();
    setError("");
    if (!form.companyName.trim()) return setError("Real company name is required");
    if (form.companyWebsite.trim()) {
      try { new URL(form.companyWebsite); } catch { return setError("Enter a valid website URL"); }
    }
    setConverting(true);
    try {
      const { slug } = await cloneToReal(org.slug, {
        companyName: form.companyName.trim(),
        companyWebsite: form.companyWebsite.trim(),
        copyLogo: form.copyLogo,
      });
      navigate(`/orgs/${slug}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setConverting(false);
    }
  }

  return (
    <SectionCard title="🎭 Demo tools">
      <div className="demo-tools">
        <div className="demo-tools__row">
          <div className="demo-tools__logo">
            <img
              src={`/api/orgs/${org.slug}/logo/color?v=${logoVer}`}
              alt="logo"
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
            />
          </div>
          <div className="demo-tools__col">
            <p className="demo-tools__desc">Demo logo — use a clean “Your Logo” placeholder, or generate a fake AI logo{org.industry ? ` (${org.industry})` : ""}.</p>
            <div className="demo-tools__actions">
              <button className="btn btn--primary" onClick={handleSetPlaceholder} disabled={logoBusy}>
                {logoBusy ? "Working…" : "Use “Your Logo” placeholder"}
              </button>
              <button className="btn btn--secondary" onClick={handleGenerateLogo} disabled={logoBusy}>
                ✨ AI logo
              </button>
            </div>
            {logoMsg && <span className="demo-tools__ok">{logoMsg}</span>}
          </div>
        </div>

        <div className="demo-tools__divider" />

        {!showConvert ? (
          <button className="btn btn--primary" onClick={() => setShowConvert(true)}>Convert to Real Client →</button>
        ) : (
          <form className="demo-tools__convert" onSubmit={handleConvert}>
            <p className="demo-tools__desc">Clones this catalog + item images into a new real-client org. Swap in the real identity; add the real logo separately — or carry over the demo logo below.</p>
            <label className="form-label">Real company name
              <input className="form-input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Acme Insulation LLC" disabled={converting} />
            </label>
            <label className="form-label">Website (optional)
              <input className="form-input" value={form.companyWebsite} onChange={(e) => setForm({ ...form, companyWebsite: e.target.value })} placeholder="https://acme.com" disabled={converting} />
            </label>
            <label className="demo-tools__check">
              <input type="checkbox" checked={form.copyLogo} onChange={(e) => setForm({ ...form, copyLogo: e.target.checked })} disabled={converting} />
              Copy the demo logo to the new org
            </label>
            <div className="demo-tools__actions">
              <button type="button" className="btn btn--secondary" onClick={() => setShowConvert(false)} disabled={converting}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={converting}>{converting ? "Cloning…" : "Create Real Org"}</button>
            </div>
          </form>
        )}
        {error && <p className="error-text">{error}</p>}
      </div>
    </SectionCard>
  );
}

export default function OrgDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setLoading(true);
      const data = await getOrg(slug);
      setOrg(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [slug]);

  async function handleDelete() {
    if (!confirm(`Delete "${org.name}"? This cannot be undone.`)) return;
    await deleteOrg(slug);
    navigate("/");
  }

  if (loading) return (
    <div className="page"><div className="dashboard-empty"><div className="spinner" /><p>Loading…</p></div></div>
  );

  if (error || !org) return (
    <div className="page">
      <div className="dashboard-empty">
        <p className="error-text">{error || "Org not found"}</p>
        <button className="btn btn--secondary" onClick={() => navigate("/")}>← Back</button>
      </div>
    </div>
  );

  const totalItems = org.resources.categories.reduce((s, c) => s + c.items.length, 0);
  const statusCls = { draft: "badge--draft", deployed: "badge--deployed", partial: "badge--partial" }[org.status] || "badge--draft";

  return (
    <div className="page detail-page">
      <div className="detail-nav">
        <button className="btn-back" onClick={() => navigate("/")}>← Orgs</button>
        <div className="detail-nav__actions">
          {org.deployment?.lastDeployedAt && (
            <button className="btn btn--secondary" onClick={() => navigate(`/orgs/${org.slug}/deploy-result`)}>Deploy results</button>
          )}
          <button className="btn btn--secondary" onClick={() => navigate(`/orgs/${org.slug}/settings`)}>Settings</button>
          <button className="btn btn--danger-outline" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      <div className="detail-hero">
        <div className="detail-hero__left">
          <div className="detail-hero__badges">
            <span className={`badge ${statusCls}`}>{org.status}</span>
            {org.source === "real_client" && <span className="badge badge--source">Real Client</span>}
            {org.source === "demo" && <span className="badge badge--source">Demo</span>}
          </div>
          <h1 className="detail-hero__name">{org.name}</h1>
          <p className="detail-hero__meta">
            {org.industry}{org.region ? ` · ${org.region}` : ""} · {org.slug}
          </p>
          {org.websiteUrl && (
            <a className="detail-hero__url" href={org.websiteUrl} target="_blank" rel="noreferrer">
              {org.websiteUrl}
            </a>
          )}
        </div>
        <div className="detail-hero__stats">
          <StatBadge label="branches" value={org.stats?.branches ?? org.branches.length} />
          <StatBadge label="categories" value={org.stats?.categories ?? org.resources.categories.length} />
          <StatBadge label="items" value={org.stats?.items ?? totalItems} />
          <StatBadge label="work areas" value={org.stats?.workAreas ?? org.resources.workAreas.length} />
          <StatBadge label="factors" value={org.stats?.factors ?? org.resources.factors.length} />
          <StatBadge label="users" value={org.users.length} />
        </div>
      </div>

      <div className="detail-sections">
        {org.source === "demo" && <DemoActions org={org} onChanged={load} />}
        {org.multiIndustry && <WorkAreaBuilderSection org={org} onChanged={load} />}
        <BranchSection branches={org.branches} />
        <CatalogSection resources={org.resources} />
        <ImagesSection org={org} />
        <VideoSection org={org} />
        <UsersSection users={org.users} slug={org.slug} />
        <DeploySection
          slug={org.slug}
          status={org.status}
          onDeployed={load}
        />
      </div>
    </div>
  );
}
