import { useState, useEffect, useRef } from "react";
import { orgLogoUrl, uploadLogoVariant, deleteLogoVariant, fetchLogoVariants } from "../services/enrichApi.js";

const VARIANTS = [
  { id: "white",   label: "White",   hint: "For dark backgrounds",   bg: "#1a1a2e" },
  { id: "dark",    label: "Dark",    hint: "For light backgrounds",   bg: "#f8fafc" },
  { id: "color",   label: "Color",   hint: "For neutral backgrounds", bg: "#e8f0fe" },
  { id: "default", label: "Default", hint: "Fallback / general use",  bg: "#f3f4f6" },
];

export default function LogoLibrary({ orgId, onClose }) {
  const [available, setAvailable] = useState([]);
  const [uploading, setUploading] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(null);
  const fileRefs = useRef({});

  useEffect(() => {
    if (!orgId) return;
    fetchLogoVariants(orgId).then(setAvailable).catch(() => setAvailable([]));
  }, [orgId, refresh]);

  const handleUpload = async (variant, file) => {
    setUploading(variant);
    setError(null);
    try {
      await uploadLogoVariant(orgId, variant, file);
      setRefresh((r) => r + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (variant) => {
    if (!confirm(`Remove the ${variant} logo?`)) return;
    setDeleting(variant);
    try {
      await deleteLogoVariant(orgId, variant);
      setRefresh((r) => r + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="logo-lib-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="logo-lib">
        <div className="logo-lib__header">
          <div>
            <h3 className="logo-lib__title">Logo Library</h3>
            <p className="logo-lib__subtitle">Upload a variant for each background type. The system auto-selects the best one per image.</p>
          </div>
          <button className="logo-lib__close" onClick={onClose}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {error && <div className="logo-lib__error">⚠ {error}</div>}

        <div className="logo-lib__grid">
          {VARIANTS.map((v) => {
            const has = available.includes(v.id);
            const logoUrl = `${orgLogoUrl(orgId, v.id)}?t=${refresh}`;
            return (
              <div key={v.id} className={`logo-lib__card ${has ? "logo-lib__card--has" : ""}`}>
                {/* Preview area */}
                <div className="logo-lib__preview" style={{ background: v.bg }}>
                  {has ? (
                    <img
                      src={logoUrl}
                      alt={v.label}
                      className="logo-lib__img"
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                  ) : (
                    <div className="logo-lib__empty-preview">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28" style={{ opacity: 0.3 }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="logo-lib__info">
                  <div className="logo-lib__name">
                    {v.label}
                    {has && <span className="logo-lib__badge">✓</span>}
                  </div>
                  <div className="logo-lib__hint">{v.hint}</div>
                </div>

                {/* Actions */}
                <div className="logo-lib__actions">
                  <button
                    className="logo-lib__btn logo-lib__btn--upload"
                    disabled={uploading === v.id}
                    onClick={() => fileRefs.current[v.id]?.click()}
                  >
                    {uploading === v.id ? "…" : has ? "Replace" : "Upload"}
                  </button>
                  {has && (
                    <button
                      className="logo-lib__btn logo-lib__btn--delete"
                      disabled={deleting === v.id}
                      onClick={() => handleDelete(v.id)}
                    >
                      {deleting === v.id ? "…" : "Remove"}
                    </button>
                  )}
                </div>

                <input
                  ref={(el) => { fileRefs.current[v.id] = el; }}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(v.id, file);
                    e.target.value = "";
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="logo-lib__footer">
          <p className="logo-lib__tip">
            💡 <strong>Tip:</strong> Upload a white PNG for dark images, a dark PNG for white/light images, and a color version for everything else. The system picks automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
