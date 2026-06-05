import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getOrg, deleteOrg, deployOrg, planOrgDeployment } from "../services/orgApi.js";

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

  const totalItems = org.resources.categories.reduce((s, c) => s + c.items.length, 0);
  const itemsWithImages = org.resources.categories.reduce(
    (s, c) => s + c.items.filter((i) => i.imageUrl).length,
    0
  );
  const coverage = totalItems > 0 ? Math.round((itemsWithImages / totalItems) * 100) : 0;

  return (
    <SectionCard title={`Item Images — ${itemsWithImages} / ${totalItems} (${coverage}%)`}>
      <div className="img-section">
        <div className="img-progress-bar">
          <div className="img-progress-bar__fill" style={{ width: `${coverage}%` }} />
        </div>

        <div className="img-categories">
          {org.resources.categories.map((cat) => {
            const withImages = cat.items.filter((i) => i.imageUrl).length;
            const isOpen = expandedCat === cat.name;
            return (
              <div key={cat.name} className="img-cat-card">
                <button
                  className="img-cat-card__toggle img-cat-card__header"
                  onClick={() => setExpandedCat(isOpen ? null : cat.name)}
                >
                  <span className="img-cat-card__chevron">{isOpen ? "▾" : "▸"}</span>
                  <span className="img-cat-card__name">{cat.name}</span>
                  <span className={`img-cat-card__count ${withImages === cat.items.length ? "img-cat-card__count--full" : ""}`}>
                    {withImages}/{cat.items.length}
                  </span>
                </button>

                {isOpen && (
                  <div className="img-cat-card__grid">
                    {cat.items.map((item) => (
                      <div
                        key={item.name}
                        className={`img-thumb ${item.imageUrl ? "img-thumb--has" : "img-thumb--empty"}`}
                      >
                        {item.imageUrl && (
                          <img src={item.imageUrl} alt={item.name} className="img-thumb__img" />
                        )}
                        <div className="img-thumb__label">{item.name}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="img-section__hint" style={{ marginTop: 8 }}>
          Generate images from <strong>Settings → Price Book</strong>.
        </p>
      </div>
    </SectionCard>
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
