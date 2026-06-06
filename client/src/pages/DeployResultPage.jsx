import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getOrg, exportDeployUsers } from "../services/orgApi.js";

const LOG_STATUS_ICONS = { running: "⟳", done: "✓", failed: "✗" };

function actionTotals(actions) {
  const byCollection = {};
  let created = 0;
  let updated = 0;
  for (const a of actions) {
    const key = a.collection || "other";
    byCollection[key] = byCollection[key] || { created: 0, updated: 0 };
    if (a.operation === "updated") { byCollection[key].updated += 1; updated += 1; }
    else { byCollection[key].created += 1; created += 1; }
  }
  return { byCollection, created, updated, total: actions.length };
}

export default function DeployResultPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setOrg(await getOrg(slug));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

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

  const deployment = org.deployment;
  const deployed = Boolean(deployment?.lastDeployedAt);
  const credentials = deployment?.credentials || [];
  const log = deployment?.log || [];
  const totals = actionTotals(deployment?.actions || []);
  const failed = Boolean(deployment?.lastError);

  return (
    <div className="page detail-page">
      <div className="detail-nav">
        <button className="btn-back" onClick={() => navigate(`/orgs/${slug}`)}>← {org.name}</button>
        <div className="detail-nav__actions">
          <button className="btn btn--secondary" onClick={() => navigate(`/orgs/${slug}`)}>Org detail</button>
        </div>
      </div>

      <div className="detail-hero">
        <div className="detail-hero__left">
          <div className="detail-hero__badges">
            <span className={`badge ${failed ? "badge--partial" : "badge--deployed"}`}>
              {failed ? "partial" : "deployed"}
            </span>
          </div>
          <h1 className="detail-hero__name">Deploy results</h1>
          <p className="detail-hero__meta">
            {org.name} · {org.slug}
            {deployed && <> · {new Date(deployment.lastDeployedAt).toLocaleString()}</>}
          </p>
        </div>
      </div>

      {!deployed ? (
        <div className="deploy-result deploy-result--error">
          This org has not been deployed yet. <Link to={`/orgs/${slug}`}>Run a deploy</Link> first.
        </div>
      ) : (
        <div className="detail-sections">
          <div className={`deploy-result ${failed ? "deploy-result--error" : "deploy-result--success"}`}>
            {failed ? `✗ ${deployment.lastError}` : "✓ Deployed successfully"}
          </div>

          <div className="section-card">
            <div className="section-card__header section-card__header--static">
              <span>Target</span>
            </div>
            <div className="section-card__body">
              <div className="deploy-plan__target">
                <strong>{deployment.target?.name || "—"}</strong>
                {deployment.organizationId && <span>ID: {deployment.organizationId}</span>}
                {deployment.target?.apiUrl && <span>{deployment.target.apiUrl}</span>}
                {deployment.actor?.email && <span>by {deployment.actor.email}</span>}
              </div>
              <div className="deploy-plan__totals">
                <span>{totals.created} created</span>
                <span>{totals.updated} updated</span>
                <span>{totals.total} total</span>
                <span>{credentials.length} users</span>
              </div>
              <div className="deploy-plan__collections">
                {Object.entries(totals.byCollection).map(([collection, counts]) => (
                  <div key={collection} className="deploy-plan__collection">
                    <span className="deploy-plan__collection-name">{collection}</span>
                    <span className="deploy-plan__collection-count">
                      {counts.created} created{counts.updated ? `, ${counts.updated} updated` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="section-card">
            <div className="section-card__header section-card__header--static">
              <span>Created users ({credentials.length})</span>
              <button className="btn btn--deploy deploy-export-btn" onClick={handleExport} disabled={exporting || !credentials.length}>
                {exporting ? "Exporting…" : "Export Excel"}
              </button>
            </div>
            <div className="section-card__body">
              {exportError && <div className="deploy-result deploy-result--error">{exportError}</div>}
              {credentials.length === 0 ? (
                <p className="detail-row__sub">No users were created on this deploy.</p>
              ) : (
                <div className="deploy-users-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Password</th>
                        <th>Role</th>
                        <th>Branches</th>
                      </tr>
                    </thead>
                    <tbody>
                      {credentials.map((c) => (
                        <tr key={c.email}>
                          <td>{c.name || "—"}</td>
                          <td><code>{c.email}</code></td>
                          <td><code>{c.password}</code></td>
                          <td>{c.role}</td>
                          <td>{(c.branches || []).join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {log.length > 0 && (
            <div className="section-card">
              <div className="section-card__header section-card__header--static">
                <span>Deploy log</span>
              </div>
              <div className="section-card__body">
                <div className="deploy-log">
                  {log.map((entry, i) => (
                    <div key={i} className={`deploy-log__entry deploy-log__entry--${entry.status}`}>
                      <span className="deploy-log__icon">{LOG_STATUS_ICONS[entry.status] || "•"}</span>
                      <span className="deploy-log__name">{entry.name}</span>
                      {entry.detail && <span className="deploy-log__detail">{entry.detail}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
