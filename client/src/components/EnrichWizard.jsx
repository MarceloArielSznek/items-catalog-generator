import { useState, useEffect, useCallback } from "react";
import { fetchEnrichCandidates, applyEnrich, orgLogoUrl, generateEnrichImage, proxyImageUrl } from "../services/enrichApi.js";
import LogoPositionGrid from "./LogoPositionGrid.jsx";

const VARIANT_LABELS = { white: "White", dark: "Dark", color: "Color", default: "Default" };
const VARIANT_BG = { white: "#1a1a2e", dark: "#f8fafc", color: "#e8f0fe", default: "#f3f4f6" };

const LIGHTING_DEFAULTS = { brightness: 1, contrast: 1, saturation: 1, warmth: 0 };
const LOGO_SCALE_DEFAULT = 0.25;
const MEASURE_PATTERNS = [
  /\bR[-\s]?\d+(?:\.\d+)?\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:sq\.?\s*ft\.?|sf|ft2|ft²|linear\s*ft\.?|lf|in\.?|inch(?:es)?|ft\.?|feet|yard(?:s)?|yd\.?)\b/gi,
  /\b\d+(?:\.\d+)?\s*(?:x|×|by)\s*\d+(?:\.\d+)?(?:\s*(?:x|×|by)\s*\d+(?:\.\d+)?)?(?:\s*(?:in\.?|ft\.?|cm|mm))?\b/gi,
  /\b\d+(?:\.\d+)?\s*["']/g,
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMeasureTokens(name = "") {
  const tokens = [];
  for (const pattern of MEASURE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of name.matchAll(pattern)) {
      const token = match[0].replace(/\s+/g, " ").trim();
      if (token && !tokens.some((existing) => existing.toLowerCase() === token.toLowerCase())) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}

function normalizeItemBaseName(name = "") {
  let normalized = name;
  for (const pattern of MEASURE_PATTERNS) {
    normalized = normalized.replace(pattern, " ");
  }
  return normalized
    .toLowerCase()
    .replace(/[-–—|,/()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDescriptionForVariant(description, sourceName, targetName) {
  const sourceTokens = extractMeasureTokens(sourceName);
  const targetTokens = extractMeasureTokens(targetName);
  let next = description || "";

  sourceTokens.forEach((token, index) => {
    const replacement = targetTokens[index];
    if (!replacement) return;
    next = next.replace(new RegExp(escapeRegExp(token), "gi"), replacement);
  });

  if (next === description && sourceName && targetName) {
    next = next.replace(new RegExp(escapeRegExp(sourceName), "gi"), targetName);
  }

  return next;
}

function buildCssFilter({ brightness, contrast, saturation, warmth }) {
  let f = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
  if (warmth > 0) f += ` sepia(${warmth * 0.3})`;
  if (warmth < 0) f += ` hue-rotate(${warmth * 20}deg)`;
  return f;
}

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <div className="ew-slider">
      <div className="ew-slider__header">
        <span>{label}</span>
        <strong>{value.toFixed(2)}</strong>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

function ItemStep({ item, orgId, hasLogo, onDone, onSkip, stepIndex, totalSteps, siblingItems }) {
  const [candidates, setCandidates] = useState(item.candidates || []);
  const [selectedImg, setSelectedImg] = useState(null);
  const [description, setDescription] = useState(item.description || "");
  const [lighting, setLighting] = useState({ ...LIGHTING_DEFAULTS });
  const [logoPosition, setLogoPosition] = useState("bottom-right");
  const [logoScale, setLogoScale] = useState(LOGO_SCALE_DEFAULT);
  const [logoVariant, setLogoVariant] = useState(null); // null = auto
  const [applyToGroup, setApplyToGroup] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const availableVariants = item.logoVariants || [];
  const updateLighting = (key, val) => setLighting((prev) => ({ ...prev, [key]: val }));
  const cssFilter = buildCssFilter(lighting);
  const activeVariant = logoVariant || availableVariants[0] || null;
  const logoSrc = orgId && activeVariant ? `${orgLogoUrl(orgId, activeVariant)}?t=1` : null;
  const currentBaseName = normalizeItemBaseName(item.itemName);
  const selectedItems = siblingItems.filter((candidate) =>
    candidate?.id && String(candidate.id) !== String(item.itemId)
  );
  const matchingItems = selectedItems.filter((candidate) => {
    if (!candidate?.id || String(candidate.id) === String(item.itemId)) return false;
    if (!extractMeasureTokens(candidate.name).length) return false;
    return normalizeItemBaseName(candidate.name) === currentBaseName;
  });
  const groupItems = matchingItems.length > 0 ? matchingItems : selectedItems;
  const groupModeLabel = matchingItems.length > 0 ? "matching items" : "selected items";
  const canApplyToGroup = groupItems.length > 0;
  const saveTargets = applyToGroup && canApplyToGroup
    ? [{ id: item.itemId, name: item.itemName }, ...groupItems]
    : [{ id: item.itemId, name: item.itemName }];

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateEnrichImage(item.itemId, {
        itemName: item.itemName,
        categoryName: item.categoryName,
        description,
      });
      const aiCandidate = { ...result, thumbUrl: result.url, isAI: true };
      setCandidates((prev) => [aiCandidate, ...prev]);
      setSelectedImg(aiCandidate);
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!selectedImg) return;
    setSaving(true);
    setError(null);
    try {
      for (const target of saveTargets) {
        await applyEnrich(target.id, orgId, {
          imageUrl: selectedImg.url,
          description: buildDescriptionForVariant(description, item.itemName, target.name),
          lighting,
          logoPosition: hasLogo ? logoPosition : null,
          logoScale,
          logoVariant, // null = auto-select on server
        });
      }
      onDone(saveTargets.map((target) => target.id));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="ew-step">
      {/* Top bar */}
      <div className="ew-step__header">
        <div className="ew-step__meta">
          <p className="ew-step__progress">✦ {stepIndex + 1} / {totalSteps}</p>
          <h2 className="ew-step__name">{item.itemName}</h2>
          {item.categoryName && <p className="ew-step__cat">{item.categoryName}</p>}
        </div>
        <div className="ew-step__actions">
          <button className="ew-btn ew-btn--ghost" onClick={onSkip}>Skip</button>
          <button className="ew-btn ew-btn--primary" onClick={handleSave}
            disabled={!selectedImg || saving}>
            {saving
              ? <><span className="ew-loading__spinner ew-loading__spinner--sm" /> Saving {saveTargets.length}…</>
              : selectedImg ? `Save ${saveTargets.length > 1 ? `${saveTargets.length} items` : "& Next"} →` : "Select an image"}
          </button>
        </div>
      </div>

      {error && (
        <div className="ew-error" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontWeight: 700, fontSize: 14, padding: "0 4px" }}>✕</button>
        </div>
      )}

      <div className="ew-step__body">

        {/* ── LEFT: description + candidates ── */}
        <div className="ew-left">
          <div>
            <label className="ew-label">Description</label>
            <textarea className="ew-description" value={description}
              onChange={(e) => setDescription(e.target.value)} rows={6}
              placeholder="AI-generated description will appear here…" />
          </div>

          {canApplyToGroup && (
            <label className="ew-group-apply">
              <input
                type="checkbox"
                checked={applyToGroup}
                onChange={(e) => setApplyToGroup(e.target.checked)}
              />
              <span>
                <strong>Apply same image to {groupItems.length + 1} {groupModeLabel}</strong>
                <small>
                  {saveTargets.map((target) => extractMeasureTokens(target.name)[0] || target.name).join(" / ")}
                </small>
              </span>
            </label>
          )}

          <div className="ew-candidates-header">
            <label className="ew-label">Choose an image</label>
            <button
              className={`ew-ai-btn ${generating ? "ew-ai-btn--loading" : ""}`}
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating
                ? <><span className="ew-loading__spinner ew-loading__spinner--sm" /> Generating…</>
                : <>✨ Generate with AI</>}
            </button>
          </div>

          <div className="ew-candidates">
            {candidates.map((c, i) => (
              <button
                key={c.url + i}
                className={`ew-candidate ${selectedImg?.url === c.url ? "ew-candidate--selected" : ""}`}
                onClick={() => setSelectedImg(c)}
              >
                {c.isAI && <span className="ew-candidate__ai-badge">✨ AI</span>}
                <img src={c.thumbUrl || c.url} alt={`Option ${i + 1}`} className="ew-candidate__img"
                  onError={(e) => { e.target.src = c.url; }} />
                <span className="ew-candidate__domain">{c.isAI ? "DALL-E 3" : c.domain}</span>
                {selectedImg?.url === c.url && <span className="ew-candidate__check">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ── RIGHT: preview + controls ── */}
        <div className="ew-right">
          <label className="ew-label">Preview</label>

          <div className="ew-preview">
            {selectedImg ? (
              <div className="ew-preview__canvas">
                <img src={proxyImageUrl(selectedImg.url)} alt="preview"
                  className="ew-preview__img"
                  style={{ filter: cssFilter }} />
                {hasLogo && logoSrc && (
                  <img src={logoSrc} alt="logo"
                    className={`ew-preview__logo ew-preview__logo--${logoPosition}`}
                    style={{ width: `${logoScale * 100}%` }}
                    onError={(e) => { e.target.style.display = "none"; }} />
                )}
              </div>
            ) : (
              <div className="ew-preview__empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="40" height="40">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 21h10.5A2.25 2.25 0 0019.5 18.75V6.75A2.25 2.25 0 0017.25 4.5H6.75A2.25 2.25 0 004.5 6.75v12A2.25 2.25 0 006.75 21z" />
                </svg>
                <p>Select an image</p>
              </div>
            )}
          </div>

          {selectedImg && (
            <div className="ew-controls">
              {/* Lighting */}
              <p className="ew-controls__title">Lighting</p>
              <Slider label="Brightness" value={lighting.brightness} min={0.5} max={1.5} step={0.05} onChange={(v) => updateLighting("brightness", v)} />
              <Slider label="Contrast"   value={lighting.contrast}   min={0.5} max={2.0} step={0.05} onChange={(v) => updateLighting("contrast", v)} />
              <Slider label="Saturation" value={lighting.saturation} min={0}   max={2.0} step={0.05} onChange={(v) => updateLighting("saturation", v)} />
              <Slider label="Warmth"     value={lighting.warmth}     min={-1}  max={1}   step={0.05} onChange={(v) => updateLighting("warmth", v)} />
              <button className="ew-btn ew-btn--ghost ew-btn--sm" style={{ marginTop: 6 }}
                onClick={() => setLighting({ ...LIGHTING_DEFAULTS })}>
                Reset
              </button>

              {/* Logo */}
              {hasLogo && (
                <>
                  <p className="ew-controls__title" style={{ marginTop: 20 }}>Logo</p>

                  {/* Variant picker */}
                  {availableVariants.length > 1 && (
                    <div className="ew-variant-picker">
                      <button
                        className={`ew-variant-btn ${logoVariant === null ? "ew-variant-btn--active" : ""}`}
                        onClick={() => setLogoVariant(null)}
                        title="Auto-select based on image"
                      >
                        Auto
                      </button>
                      {availableVariants.map((v) => (
                        <button
                          key={v}
                          className={`ew-variant-btn ${logoVariant === v ? "ew-variant-btn--active" : ""}`}
                          style={{ background: logoVariant === v ? VARIANT_BG[v] : undefined }}
                          onClick={() => setLogoVariant(v)}
                          title={VARIANT_LABELS[v]}
                        >
                          {v === "white" ? "☀" : v === "dark" ? "◼" : v === "color" ? "🎨" : "⬡"}
                          {" "}{VARIANT_LABELS[v]}
                        </button>
                      ))}
                    </div>
                  )}

                  <LogoPositionGrid value={logoPosition} onChange={setLogoPosition} />
                  <Slider label="Logo size" value={logoScale} min={0.08} max={0.45} step={0.01}
                    onChange={setLogoScale} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemLoading({ name }) {
  return (
    <div className="ew-loading">
      <div className="ew-loading__spinner" />
      <p>Loading candidates for <strong>{name}</strong>…</p>
    </div>
  );
}

export default function EnrichWizard({ items, orgId, orgName, onClose, onFinished }) {
  const [enrichData, setEnrichData] = useState({});
  const [loadingIds, setLoadingIds] = useState(new Set());
  const [errorIds, setErrorIds] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [doneIds, setDoneIds] = useState(new Set());

  const itemList = items.filter((it) => !doneIds.has(String(it.id)));
  const currentItem = itemList[currentIndex];

  const loadCandidates = useCallback(async (item) => {
    if (!item || enrichData[item.id] || loadingIds.has(item.id)) return;
    setLoadingIds((s) => new Set([...s, item.id]));
    try {
      const data = await fetchEnrichCandidates(item.id, orgId, orgName);
      setEnrichData((prev) => ({ ...prev, [item.id]: data }));
    } catch (err) {
      setErrorIds((prev) => ({ ...prev, [item.id]: err.message }));
    } finally {
      setLoadingIds((s) => { const n = new Set(s); n.delete(item.id); return n; });
    }
  }, [enrichData, loadingIds, orgId, orgName]);

  useEffect(() => {
    if (currentItem) loadCandidates(currentItem);
    const next = itemList[currentIndex + 1];
    if (next) loadCandidates(next);
  }, [currentIndex, currentItem]);

  const goNext = (nextDoneIds = doneIds) => {
    const remaining = items.filter((it) => !nextDoneIds.has(String(it.id)));
    if (remaining.length === 0) {
      onFinished?.();
      return;
    }
    if (currentIndex < remaining.length - 1) setCurrentIndex((i) => i + 1);
    else setCurrentIndex(Math.max(0, remaining.length - 1));
  };

  const handleDone = (ids) => {
    const list = Array.isArray(ids) ? ids : [ids];
    const nextDoneIds = new Set([...doneIds, ...list.map(String)]);
    setDoneIds(nextDoneIds);
    goNext(nextDoneIds);
  };

  const handleSkip = () => {
    if (currentIndex < itemList.length - 1) setCurrentIndex((i) => i + 1);
    else onFinished?.();
  };

  if (itemList.length === 0) {
    return (
      <div className="ew-overlay">
        <div className="ew-modal">
          <button className="ew-close" onClick={onClose}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          <div className="ew-finished">
            <p className="ew-finished__icon">✅</p>
            <h2>All done!</h2>
            <p>{doneIds.size} item{doneIds.size !== 1 ? "s" : ""} enriched.</p>
            <button className="ew-btn ew-btn--primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ew-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ew-modal">
        <button className="ew-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {!currentItem ? null
          : loadingIds.has(currentItem.id) ? <ItemLoading name={currentItem.name} />
          : errorIds[currentItem.id] ? (
            <div className="ew-loading">
              <p style={{ color: "#dc2626" }}>⚠ {errorIds[currentItem.id]}</p>
              <button className="ew-btn ew-btn--ghost" onClick={handleSkip}>Skip</button>
            </div>
          ) : enrichData[currentItem.id] ? (
            <ItemStep
              item={enrichData[currentItem.id]}
              orgId={orgId}
              hasLogo={enrichData[currentItem.id].hasLogo}
              onDone={handleDone}
              onSkip={handleSkip}
              stepIndex={currentIndex}
              totalSteps={itemList.length}
              siblingItems={itemList}
            />
          ) : null}
      </div>
    </div>
  );
}
