import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getOrg, deleteOrg, deployOrg, planOrgDeployment, generateOrgLogo, setLogoPlaceholder, cloneToReal } from "../services/orgApi.js";

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

function UsersSection({ users }) {
  const roleGroups = users.reduce((acc, u) => {
    if (!acc[u.role]) acc[u.role] = [];
    acc[u.role].push(u);
    return acc;
  }, {});

  return (
    <SectionCard title={`Users (${users.length})`}>
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

function DeploySection({ slug, status, onDeployed }) {
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [planning, setPlanning] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [plan, setPlan] = useState(null);
  const [confirmation, setConfirmation] = useState("");
  const [log, setLog] = useState([]);
  const [result, setResult] = useState(null);

  const LOG_STATUS_ICONS = { running: "⟳", done: "✓", failed: "✗" };

  function options(extra = {}) {
    return {
      apiUrl: apiUrl.trim(),
      apiKey: apiKey.trim(),
      ...extra,
    };
  }

  function clearPlan() {
    setPlan(null);
    setConfirmation("");
    setLog([]);
    setResult(null);
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
      }));
      setLog(res.log || []);
      setResult({ success: true });
      onDeployed?.();
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
          Existing-org only. The dry run authenticates with a service-account API key (bound to one organization)
          and shows the planned upserts. Deployment never creates or deletes an organization.
        </div>

        <div className="form-row">
          <label className="form-label">API Base URL</label>
          <input
            className="form-input"
            placeholder="https://app.your-instance.com"
            value={apiUrl}
            onChange={(e) => { setApiUrl(e.target.value); clearPlan(); }}
            disabled={planning || deploying}
          />
        </div>

        <div className="form-row">
          <label className="form-label">Service Account API Key</label>
          <input
            className="form-input form-input--mono"
            type="password"
            placeholder="mk_live_… (key scoped to the target org)"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); clearPlan(); }}
            disabled={planning || deploying}
          />
        </div>

        <button
          className="btn btn--deploy"
          onClick={handlePlan}
          disabled={planning || deploying || !apiUrl || !apiKey}
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
            <div className="deploy-plan__collections">
              {plan.collections.map((collection) => (
                <div key={collection.label}>
                  <strong>{collection.label}</strong>
                  <span>{collection.create.length} create / {collection.update.length} update / {collection.untouched} untouched</span>
                </div>
              ))}
            </div>
            <div className="deploy-plan__deferred">
              Deferred: {plan.deferred.users} users, {plan.deferred.vehicles} vehicles, {plan.deferred.equipmentTypes} equipment types, {plan.deferred.images} images.
            </div>
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
          <div className="deploy-log">
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
  const [form, setForm] = useState({ companyName: "", companyWebsite: "" });
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
            <p className="demo-tools__desc">Clones this catalog + item images into a new real-client org. Swap in the real identity; add the real logo separately.</p>
            <label className="form-label">Real company name
              <input className="form-input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="Acme Insulation LLC" disabled={converting} />
            </label>
            <label className="form-label">Website (optional)
              <input className="form-input" value={form.companyWebsite} onChange={(e) => setForm({ ...form, companyWebsite: e.target.value })} placeholder="https://acme.com" disabled={converting} />
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
        <BranchSection branches={org.branches} />
        <CatalogSection resources={org.resources} />
        <ImagesSection org={org} />
        <UsersSection users={org.users} />
        <DeploySection
          slug={org.slug}
          status={org.status}
          onDeployed={load}
        />
      </div>
    </div>
  );
}
