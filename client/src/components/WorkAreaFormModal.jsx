import { useState, useEffect } from "react";
import { createWorkArea, updateWorkArea, fetchWorkArea, fetchCategories, fetchFactors, fetchOrganizations } from "../services/payloadApi.js";

const DEFAULT_ORGANIZATION_NAME = "Attic Projects";

function normalizeRelationList(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((entry) => {
    if (entry == null) return { id: null, label: "" };
    if (typeof entry === "object" && "id" in entry) {
      return { id: entry.id, label: entry.title || entry.name || `ID: ${entry.id}` };
    }
    return { id: entry, label: `ID: ${entry}` };
  }).filter((x) => x.id != null);
}

export default function WorkAreaFormModal({ workAreaId, onClose, onSaved }) {
  const [name, setName] = useState("");
  const [organizationId, setOrganizationId] = useState(null);
  const [itemCategories, setItemCategories] = useState([]);
  const [factors, setFactors] = useState([]);
  const [categoriesOptions, setCategoriesOptions] = useState([]);
  const [factorsOptions, setFactorsOptions] = useState([]);
  const [organizationsOptions, setOrganizationsOptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!workAreaId);
  const [error, setError] = useState(null);

  const isEdit = Boolean(workAreaId);

  useEffect(() => {
    fetchCategories().then((res) => setCategoriesOptions(Array.isArray(res?.data) ? res.data : (res?.data ?? res) ?? []));
    fetchFactors().then((list) => setFactorsOptions(Array.isArray(list) ? list : []));
    fetchOrganizations().then((list) => {
      const arr = Array.isArray(list) ? list : [];
      setOrganizationsOptions(arr);
      if (!workAreaId && arr.length > 0) {
        const defaultOrg = arr.find((o) => (o.name || "").trim() === DEFAULT_ORGANIZATION_NAME);
        if (defaultOrg) setOrganizationId(defaultOrg.id);
      }
    });
  }, [workAreaId]);

  useEffect(() => {
    if (!workAreaId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWorkArea(workAreaId)
      .then((data) => {
        if (!cancelled) {
          setName(data?.name ?? "");
          const org = data?.organization;
          setOrganizationId(org != null ? (typeof org === "object" ? org.id : org) : null);
          setItemCategories(normalizeRelationList(data?.item_categories));
          setFactors(normalizeRelationList(data?.factors));
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workAreaId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: trimmed,
        organization: organizationId ?? undefined,
        item_categories: itemCategories.map((c) => c.id),
        factors: factors.map((f) => f.id),
      };
      if (isEdit) {
        await updateWorkArea(workAreaId, payload);
      } else {
        await createWorkArea(payload);
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="config-modal__overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="config-modal__content" onClick={(e) => e.stopPropagation()}>
        <div className="config-modal__header">
          <h3 className="config-modal__title">{isEdit ? "Edit Work Area" : "New Work Area"}</h3>
          <button type="button" className="config-modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {loading ? (
          <p className="config-modal__loading">Loading...</p>
        ) : (
          <form onSubmit={handleSubmit} className="config-modal__form">
            {error && (
              <div className="error-banner" style={{ marginBottom: 12 }}>
                <span className="error-banner__icon">!</span>
                <span className="error-banner__message">{error}</span>
              </div>
            )}
            <div className="config-modal__field">
              <label className="config-modal__label">Organization *</label>
              <select
                className="config-modal__input"
                value={organizationId ?? ""}
                onChange={(e) => setOrganizationId(e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">Select organization...</option>
                {organizationsOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name || "Untitled"}</option>
                ))}
              </select>
            </div>
            <div className="config-modal__field">
              <label className="config-modal__label">Name *</label>
              <input
                className="config-modal__input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Work area name"
                required
              />
            </div>

            <div className="config-modal__field">
              <label className="config-modal__label">Item categories</label>
              <div className="payload-detail__chips">
                {itemCategories.map((c) => (
                  <span key={c.id} className="payload-detail__chip">
                    {c.label}
                    <button type="button" className="payload-detail__chip-remove" onClick={() => setItemCategories((prev) => prev.filter((x) => x.id !== c.id))} aria-label="Remove">×</button>
                  </span>
                ))}
              </div>
              <select
                className="config-modal__input"
                value=""
                onChange={(e) => {
                  const id = e.target.value === "" ? null : Number(e.target.value);
                  e.target.value = "";
                  if (id != null && !itemCategories.some((c) => c.id === id)) {
                    const opt = categoriesOptions.find((a) => a.id === id);
                    setItemCategories((prev) => [...prev, { id, label: opt?.title || opt?.name || `ID: ${id}` }]);
                  }
                }}
              >
                <option value="">Select to add...</option>
                {categoriesOptions
                  .filter((a) => !itemCategories.some((c) => c.id === a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.title || a.name || "Untitled"}</option>
                  ))}
              </select>
              <div className="payload-detail__hint">Item categories associated with this work area</div>
            </div>

            <div className="config-modal__field">
              <label className="config-modal__label">Factors</label>
              <div className="payload-detail__chips">
                {factors.map((f) => (
                  <span key={f.id} className="payload-detail__chip">
                    {f.label}
                    <button type="button" className="payload-detail__chip-remove" onClick={() => setFactors((prev) => prev.filter((x) => x.id !== f.id))} aria-label="Remove">×</button>
                  </span>
                ))}
              </div>
              <select
                className="config-modal__input"
                value=""
                onChange={(e) => {
                  const id = e.target.value === "" ? null : Number(e.target.value);
                  e.target.value = "";
                  if (id != null && !factors.some((c) => c.id === id)) {
                    const opt = factorsOptions.find((a) => a.id === id);
                    setFactors((prev) => [...prev, { id, label: opt?.label || `ID: ${id}` }]);
                  }
                }}
              >
                <option value="">Select to add...</option>
                {factorsOptions
                  .filter((a) => !factors.some((c) => c.id === a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
              </select>
            </div>

            <div className="config-modal__actions">
              <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={saving || !(name || "").trim()}>
                {saving ? "Saving..." : isEdit ? "Save" : "Create"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
