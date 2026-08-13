import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listOrgs, deleteOrg } from "../services/orgApi.js";

const STATUS_LABELS = {
  draft: { label: "Draft", cls: "badge--draft" },
  deployed: { label: "Deployed", cls: "badge--deployed" },
  partial: { label: "Partial", cls: "badge--partial" },
};

const SOURCE_LABELS = {
  real_client: "Real Client",
  demo: "Demo",
};

function OrgCard({ org, onDelete, onClick }) {
  const [confirming, setConfirming] = useState(false);
  const status = STATUS_LABELS[org.status] || STATUS_LABELS.draft;

  function handleDelete(e) {
    e.stopPropagation();
    if (!confirming) { setConfirming(true); return; }
    onDelete(org.slug);
  }

  return (
    <div className="org-card" onClick={() => onClick(org.slug)}>
      <div className="org-card__header">
        <div className="org-card__meta">
          <span className={`badge ${status.cls}`}>{status.label}</span>
          <span className="badge badge--source">{SOURCE_LABELS[org.source] || org.source}</span>
        </div>
        <button
          className={`org-card__delete ${confirming ? "org-card__delete--confirm" : ""}`}
          onClick={handleDelete}
          onBlur={() => setConfirming(false)}
          title="Delete org"
        >
          {confirming ? "Confirm?" : "×"}
        </button>
      </div>

      <h3 className="org-card__name">{org.name}</h3>
      <p className="org-card__industry">{org.industry || "—"}</p>
      {org.region && <p className="org-card__region">{org.region}</p>}

      <div className="org-card__stats">
        {org.stats && (
          <>
            <span className="org-card__stat">
              <strong>{org.stats.categories}</strong> categories
            </span>
            <span className="org-card__stat">
              <strong>{org.stats.items}</strong> items
            </span>
            <span className="org-card__stat">
              <strong>{org.stats.branches}</strong>{" "}
              {org.stats.branches === 1 ? "branch" : "branches"}
            </span>
          </>
        )}
      </div>

      <div className="org-card__footer">
        <span className="org-card__slug">{org.slug}</span>
        <span className="org-card__date">
          {new Date(org.createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

export default function OrgDashboardPage() {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const data = await listOrgs();
      setOrgs(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(slug) {
    try {
      await deleteOrg(slug);
      setOrgs((prev) => prev.filter((o) => o.slug !== slug));
    } catch (e) {
      alert("Failed to delete: " + e.message);
    }
  }

  return (
    <div className="page dashboard-page">
      <div className="dashboard-header">
        <div>
          <h2 className="dashboard-title">Organizations</h2>
          <p className="dashboard-subtitle">
            Generate, preview, and deploy full org configurations to attic-tech.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => navigate("/orgs/new")}>
          + New Org
        </button>
      </div>

      {loading && (
        <div className="dashboard-empty">
          <div className="spinner" />
          <p>Loading orgs…</p>
        </div>
      )}

      {!loading && error && (
        <div className="dashboard-empty">
          <p className="error-text">Failed to load orgs: {error}</p>
          <button className="btn btn--secondary" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && orgs.length === 0 && (
        <div className="dashboard-empty">
          <div className="dashboard-empty__icon">🏢</div>
          <h3>No orgs yet</h3>
          <p>Generate your first org from a website or industry template.</p>
          <button className="btn btn--primary" onClick={() => navigate("/orgs/new")}>
            Generate first org
          </button>
        </div>
      )}

      {!loading && !error && orgs.length > 0 && (
        <div className="org-grid">
          {orgs.map((org) => (
            <OrgCard
              key={org.slug}
              org={org}
              onDelete={handleDelete}
              onClick={(slug) => navigate(`/orgs/${slug}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
