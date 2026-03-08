import { useState, useCallback, useRef } from "react";
import { processServiceImage } from "../services/api.js";
import LogoPositionGrid from "../components/LogoPositionGrid.jsx";
import FormatSelector from "../components/FormatSelector.jsx";
import { validateImageFile, createPreviewUrl, revokePreviewUrl } from "../utils/fileHelpers.js";
import { LIGHTING_DEFAULTS, COMPOSITION_DEFAULTS } from "../../../shared/constants/imageRules.js";

function LightingSlider({ label, value, min, max, step, onChange }) {
  return (
    <div className="service-lighting__slider">
      <label>{label}: <strong>{value.toFixed(2)}</strong></label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

function buildCssFilter(lighting) {
  let f = `brightness(${lighting.brightness}) contrast(${lighting.contrast}) saturate(${lighting.saturation})`;
  if (lighting.warmth > 0) f += ` sepia(${lighting.warmth * 0.25})`;
  if (lighting.warmth < 0) f += ` hue-rotate(${lighting.warmth * 15}deg)`;
  return f;
}

export default function ServicePhotoPage() {
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);

  const [format, setFormat] = useState("square");

  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [logoPosition, setLogoPosition] = useState("bottom-right");
  const [logoScale, setLogoScale] = useState(COMPOSITION_DEFAULTS.logoScale);
  const [lighting, setLighting] = useState({ ...LIGHTING_DEFAULTS });

  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  const photoRef = useRef(null);
  const logoRef = useRef(null);

  const handleLogoSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { setError(err); return; }
    setError(null);
    if (logoPreview) revokePreviewUrl(logoPreview);
    setLogoFile(file);
    setLogoPreview(createPreviewUrl(file));
    e.target.value = "";
  }, [logoPreview]);

  const handlePhotoSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { setError(err); return; }
    setError(null);
    if (photoPreview) revokePreviewUrl(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(createPreviewUrl(file));
    e.target.value = "";
  }, [photoPreview]);

  const handleProcess = useCallback(async () => {
    if (!photoFile || !logoFile) return;
    setProcessing(true);
    setError(null);
    try {
      const res = await processServiceImage({
        photo: photoFile,
        logo: logoFile,
        format,
        lighting,
        logoPosition,
        logoScale,
      });
      setResults((prev) => [{ ...res.data, originalName: photoFile.name, status: "success" }, ...prev]);
      if (photoPreview) revokePreviewUrl(photoPreview);
      setPhotoFile(null);
      setPhotoPreview(null);
      setLighting({ ...LIGHTING_DEFAULTS });
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }, [photoFile, logoFile, format, lighting, logoPosition, logoScale, photoPreview]);

  const updateLighting = useCallback((key, val) => {
    setLighting((prev) => ({ ...prev, [key]: val }));
  }, []);

  const logoScalePct = Math.round(logoScale * 100);
  const cssFilter = buildCssFilter(lighting);

  return (
    <main className="page service-page">
      <h2 className="page__title">Service Photos</h2>

      <div className="service-logo-upload">
        <div
          className={`service-logo-upload__area ${logoPreview ? "service-logo-upload__area--has-logo" : ""}`}
          onClick={() => logoRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          {logoPreview ? (
            <img className="service-logo-upload__preview" src={logoPreview} alt="Logo" />
          ) : (
            <>
              <span className="upload-field__icon">🏷️</span>
              <div className="upload-field__label">Upload Logo</div>
              <div className="upload-field__hint">Select your company logo</div>
            </>
          )}
        </div>
        {logoPreview && (
          <button className="btn btn--ghost btn--sm" onClick={() => logoRef.current?.click()}>
            Change Logo
          </button>
        )}
        <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={handleLogoSelect} />
      </div>

      <FormatSelector value={format} onChange={setFormat} />

      <div className="service-workspace">
        <div className="service-workspace__preview">
          {photoPreview ? (
            <div className="service-preview__canvas">
              <img
                className="service-preview__photo"
                src={photoPreview}
                alt="Photo preview"
                style={{ filter: cssFilter }}
              />
              {logoPreview && (
                <img
                  className={`service-preview__logo service-preview__logo--${logoPosition}`}
                  src={logoPreview}
                  alt="Logo"
                  style={{ maxWidth: `${logoScale * 100}%` }}
                />
              )}
            </div>
          ) : (
            <div
              className="service-preview__upload-area"
              onClick={() => photoRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <span className="upload-field__icon">📷</span>
              <div className="upload-field__label">Upload Photo</div>
              <div className="upload-field__hint">Select a service photo</div>
            </div>
          )}
          <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={handlePhotoSelect} />
        </div>

        <div className="service-workspace__controls">
          <LogoPositionGrid value={logoPosition} onChange={setLogoPosition} />

          <div className="input-group" style={{ marginTop: 16 }}>
            <label className="input-group__label">Logo Size: <strong>{logoScalePct}%</strong></label>
            <input
              className="composite-preview__slider"
              type="range"
              min={0.05}
              max={0.50}
              step={0.01}
              value={logoScale}
              onChange={(e) => setLogoScale(parseFloat(e.target.value))}
            />
          </div>

          <div className="service-lighting--inline">
            <h4 className="service-lighting__title">Lighting</h4>
            <LightingSlider label="Brightness" value={lighting.brightness} min={0.5} max={1.5} step={0.01} onChange={(v) => updateLighting("brightness", v)} />
            <LightingSlider label="Contrast" value={lighting.contrast} min={0.5} max={2.0} step={0.01} onChange={(v) => updateLighting("contrast", v)} />
            <LightingSlider label="Saturation" value={lighting.saturation} min={0.5} max={1.5} step={0.01} onChange={(v) => updateLighting("saturation", v)} />
            <LightingSlider label="Warmth" value={lighting.warmth} min={-1} max={1} step={0.05} onChange={(v) => updateLighting("warmth", v)} />
            <button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={() => setLighting({ ...LIGHTING_DEFAULTS })}>
              Reset Lighting
            </button>
          </div>

          {photoFile && (
            <button
              className="btn btn--primary btn--full"
              style={{ marginTop: 20 }}
              disabled={processing || !logoFile}
              onClick={handleProcess}
            >
              {processing ? "Processing..." : "Process Photo"}
            </button>
          )}

          {photoFile && !processing && (
            <button
              className="btn btn--ghost btn--full"
              style={{ marginTop: 8 }}
              onClick={() => photoRef.current?.click()}
            >
              Change Photo
            </button>
          )}

          {!photoFile && (
            <button
              className="btn btn--primary btn--full"
              style={{ marginTop: 20 }}
              onClick={() => photoRef.current?.click()}
            >
              Upload Photo
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-banner__icon">!</span>
          <span className="error-banner__message">{error}</span>
        </div>
      )}

      {results.length > 0 && (
        <div className="service-results">
          <h3 className="service-lighting__title">Processed Photos</h3>
          {results.map((r, i) => (
            <div key={i} className="service-results__item">
              <img className="service-results__thumb" src={r.imageUrl} alt={r.originalName} />
              <span className="service-results__name">{r.originalName}</span>
              <a className="btn btn--ghost btn--sm" href={r.imageUrl} download={r.filename} target="_blank" rel="noreferrer">Download</a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
