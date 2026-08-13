import { useState, useEffect, useCallback } from "react";
import { fetchEnrichCandidates, applyEnrich, orgLogoUrl, generateEnrichImage, proxyImageUrl, saveFeedback, fetchLogoVariants } from "../services/enrichApi.js";
import LogoPositionGrid from "./LogoPositionGrid.jsx";

const VARIANT_LABELS = { white: "White", dark: "Dark", color: "Color", default: "Default" };
const VARIANT_BG = { white: "#1a1a2e", dark: "#f8fafc", color: "#e8f0fe", default: "#f3f4f6" };

const LIGHTING_DEFAULTS = { brightness: 1, contrast: 1, saturation: 1, warmth: 0 };
const LOGO_SCALE_DEFAULT = 0.2;
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

function ItemStep({ item, orgId, hasLogo, logoVariants, onQueue, onSkip, onFinish, stepIndex, totalSteps, queueLength, siblingItems, isDemo, onSearchWeb }) {
  const [candidates, setCandidates] = useState(item.candidates || []);
  const [selectedImg, setSelectedImg] = useState(null);
  const [description, setDescription] = useState(item.description || "");
  const [lighting, setLighting] = useState({ ...LIGHTING_DEFAULTS });
  const [logoPosition, setLogoPosition] = useState("bottom-right");
  const [logoScale, setLogoScale] = useState(LOGO_SCALE_DEFAULT);
  const [logoVariant, setLogoVariant] = useState(null);
  const [applyToGroup, setApplyToGroup] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [searchingWeb, setSearchingWeb] = useState(false);
  const [error, setError] = useState(null);
  const [feedbackModal, setFeedbackModal] = useState(null);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [feedbackDetail, setFeedbackDetail] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(3);

  const availableVariants = logoVariants || [];
  const updateLighting = (key, val) => setLighting((prev) => ({ ...prev, [key]: val }));
  const cssFilter = buildCssFilter(lighting);
  const activeVariant = logoVariant || availableVariants[0] || null;
  const logoSrc = orgId && activeVariant ? `${orgLogoUrl(orgId, activeVariant)}?t=1` : null;
  const currentBaseName = normalizeItemBaseName(item.itemName);
  const selectedItems = siblingItems.filter((candidate) =>
    candidate?.id && String(candidate.id) !== String(item.itemId)
  );
  const groupItems = selectedItems.filter((candidate) => {
    if (!candidate?.id || String(candidate.id) === String(item.itemId)) return false;
    if (!extractMeasureTokens(candidate.name).length && !extractMeasureTokens(item.itemName).length) return false;
    return normalizeItemBaseName(candidate.name) === currentBaseName;
  });
  const canApplyToGroup = groupItems.length > 0;
  const saveTargets = applyToGroup && canApplyToGroup
    ? [{ id: item.itemId, name: item.itemName }, ...groupItems]
    : [{ id: item.itemId, name: item.itemName }];

  // Auto-select first candidate when they arrive
  useEffect(() => {
    if (candidates.length > 0 && !selectedImg) {
      setSelectedImg(candidates[0]);
    }
  }, [candidates.length]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleSearchWeb = async () => {
    setSearchingWeb(true);
    setError(null);
    try {
      const data = await onSearchWeb();
      setCandidates((prev) => {
        const existingUrls = new Set(prev.map((c) => c.url));
        const newOnes = (data.candidates || []).filter((c) => !existingUrls.has(c.url));
        return [...prev, ...newOnes];
      });
      if (!description && data.description) setDescription(data.description);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearchingWeb(false);
    }
  };

  const handleQueue = () => {
    if (!selectedImg) return;
    onQueue({
      itemId: item.itemId,
      itemName: item.itemName,
      thumbUrl: selectedImg.thumbUrl || selectedImg.url,
      imageUrl: selectedImg.url,
      description,
      lighting: { ...lighting },
      logoPosition: hasLogo ? logoPosition : null,
      logoScale,
      logoVariant,
      saveTargets,
    });
  };

  const handleReject = () => {
    setFeedbackModal(true);
    setFeedbackReason("");
    setFeedbackDetail("");
    setFeedbackRating(3);
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackReason || !selectedImg) return;
    try {
      await saveFeedback(item.itemId, orgId, selectedImg.url, feedbackReason, feedbackDetail, feedbackRating);
      const nextCandidates = candidates.filter((c) => c.url !== selectedImg.url);
      setCandidates(nextCandidates);
      setSelectedImg(nextCandidates[0] || null);
      setFeedbackModal(false);
    } catch (err) {
      setError(`Failed to save feedback: ${err.message}`);
    }
  };

  const isEmpty = candidates.length === 0 && !generating && !searchingWeb;

  return (
    <div className="ew-step">
      {/* Top bar */}
      <div className="ew-step__header">
        <div className="ew-step__meta">
          <p className="ew-step__progress">
            ✦ {stepIndex + 1} / {totalSteps}
            {queueLength > 0 && <span className="ew-queue-count"> · ✓ {queueLength} queued</span>}
          </p>
          <h2 className="ew-step__name">{item.itemName}</h2>
          {item.categoryName && <p className="ew-step__cat">{item.categoryName}</p>}
          {isDemo && (
            <span className="ew-demo-badge" title="Base image (no logo) will also be saved locally for later reuse">
              💾 Demo — base image will be saved
            </span>
          )}
        </div>
        <div className="ew-step__actions">
          <button className="ew-btn ew-btn--ghost" onClick={onSkip}>Skip</button>
          <button className="ew-btn ew-btn--ghost" onClick={onFinish} style={{ fontSize: 12 }}>
            Review queue →
          </button>
          <button className="ew-btn ew-btn--primary" onClick={handleQueue} disabled={!selectedImg}>
            {selectedImg
              ? `Queue${saveTargets.length > 1 ? ` (${saveTargets.length})` : ""} →`
              : "Select an image"}
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
        {/* ── LEFT ── */}
        <div className="ew-left">
          <div>
            <label className="ew-label">Description</label>
            <textarea className="ew-description" value={description}
              onChange={(e) => setDescription(e.target.value)} rows={6}
              placeholder="AI-generated description will appear here…" />
          </div>

          {canApplyToGroup && (
            <label className="ew-group-apply">
              <input type="checkbox" checked={applyToGroup} onChange={(e) => setApplyToGroup(e.target.checked)} />
              <span>
                <strong>Apply to {groupItems.length + 1} matching items</strong>
                <small>
                  {saveTargets.map((target) => extractMeasureTokens(target.name)[0] || target.name).join(" / ")}
                </small>
              </span>
            </label>
          )}

          {/* Image source actions */}
          <div className="ew-candidates-header">
            <label className="ew-label">Choose an image</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className={`ew-ai-btn ${generating ? "ew-ai-btn--loading" : ""}`}
                onClick={handleGenerate}
                disabled={generating || searchingWeb}
                title="Generate an AI image with DALL-E"
              >
                {generating
                  ? <><span className="ew-loading__spinner ew-loading__spinner--sm" /> Generating…</>
                  : <>✨ AI</>}
              </button>
              <button
                className={`ew-web-btn ${searchingWeb ? "ew-web-btn--loading" : ""}`}
                onClick={handleSearchWeb}
                disabled={generating || searchingWeb}
                title="Search the web for images"
              >
                {searchingWeb
                  ? <><span className="ew-loading__spinner ew-loading__spinner--sm" /> Searching…</>
                  : <>🔍 Web</>}
              </button>
            </div>
          </div>

          {/* Empty state */}
          {isEmpty ? (
            <div className="ew-empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" width="32" height="32">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 21h10.5A2.25 2.25 0 0019.5 18.75V6.75A2.25 2.25 0 0017.25 4.5H6.75A2.25 2.25 0 004.5 6.75v12A2.25 2.25 0 006.75 21z" />
              </svg>
              <p>No image yet — use AI or search the web above</p>
            </div>
          ) : (
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
          )}

          {/* Controls */}
          {selectedImg && (
            <div className="ew-controls">
              <button
                className="ew-btn ew-btn--reject"
                onClick={handleReject}
                title="Reject this image and provide feedback for training"
              >
                👎 Not this one
              </button>

              <p className="ew-controls__title">Lighting</p>
              <Slider label="Brightness" value={lighting.brightness} min={0.5} max={1.5} step={0.05} onChange={(v) => updateLighting("brightness", v)} />
              <Slider label="Contrast"   value={lighting.contrast}   min={0.5} max={2.0} step={0.05} onChange={(v) => updateLighting("contrast", v)} />
              <Slider label="Saturation" value={lighting.saturation} min={0}   max={2.0} step={0.05} onChange={(v) => updateLighting("saturation", v)} />
              <Slider label="Warmth"     value={lighting.warmth}     min={-1}  max={1}   step={0.05} onChange={(v) => updateLighting("warmth", v)} />
              <button className="ew-btn ew-btn--ghost ew-btn--sm" style={{ marginTop: 6 }}
                onClick={() => setLighting({ ...LIGHTING_DEFAULTS })}>
                Reset
              </button>

              {hasLogo && (
                <>
                  <p className="ew-controls__title" style={{ marginTop: 20 }}>Logo</p>
                  {availableVariants.length > 1 && (
                    <div className="ew-variant-picker">
                      <button
                        className={`ew-variant-btn ${logoVariant === null ? "ew-variant-btn--active" : ""}`}
                        onClick={() => setLogoVariant(null)}
                      >Auto</button>
                      {availableVariants.map((v) => (
                        <button key={v}
                          className={`ew-variant-btn ${logoVariant === v ? "ew-variant-btn--active" : ""}`}
                          style={{ background: logoVariant === v ? VARIANT_BG[v] : undefined }}
                          onClick={() => setLogoVariant(v)}
                        >
                          {v === "white" ? "☀" : v === "dark" ? "◼" : v === "color" ? "🎨" : "⬡"} {VARIANT_LABELS[v]}
                        </button>
                      ))}
                    </div>
                  )}
                  <LogoPositionGrid value={logoPosition} onChange={setLogoPosition} />
                  <Slider label="Logo size" value={logoScale} min={0.08} max={0.45} step={0.01} onChange={setLogoScale} />
                </>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: preview ── */}
        <div className="ew-right">
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
      </div>

      {/* Feedback Modal */}
      {feedbackModal && (
        <div className="ew-feedback-overlay" onClick={() => setFeedbackModal(false)}>
          <div className="ew-feedback-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Why did you reject this image?</h3>
            <p className="ew-feedback-prompt">Your feedback helps train the system to make better choices.</p>
            <div className="ew-feedback-reasons">
              {[
                { id: "low-quality", label: "📸 Low quality / Blurry" },
                { id: "not-service", label: "❌ Not the actual service" },
                { id: "retail-product", label: "🛍️ Retail product (packaging, store)" },
                { id: "wrong-context", label: "🔄 Wrong context / Unrelated" },
                { id: "watermark", label: "⚠️ Watermark or overlay text" },
                { id: "other", label: "💭 Other reason" },
              ].map((reason) => (
                <button
                  key={reason.id}
                  className={`ew-feedback-reason ${feedbackReason === reason.id ? "ew-feedback-reason--selected" : ""}`}
                  onClick={() => setFeedbackReason(reason.id)}
                >
                  {reason.label}
                </button>
              ))}
            </div>
            {feedbackReason === "other" && (
              <textarea
                className="ew-feedback-detail"
                placeholder="Tell us more..."
                value={feedbackDetail}
                onChange={(e) => setFeedbackDetail(e.target.value)}
                rows="3"
              />
            )}
            <div className="ew-feedback-rating">
              <label>How confident are you about this feedback?</label>
              <div className="ew-rating-stars">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button key={star} className={`ew-star ${feedbackRating >= star ? "ew-star--active" : ""}`}
                    onClick={() => setFeedbackRating(star)}>★</button>
                ))}
              </div>
            </div>
            <div className="ew-feedback-actions">
              <button className="ew-btn ew-btn--ghost" onClick={() => setFeedbackModal(false)}>Cancel</button>
              <button className="ew-btn ew-btn--primary" onClick={handleSubmitFeedback} disabled={!feedbackReason}>
                Submit & Try Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemLoading({ name }) {
  return (
    <div className="ew-loading">
      <div className="ew-loading__spinner" />
      <p>Loading image for <strong>{name}</strong>…</p>
    </div>
  );
}

export default function EnrichWizard({ items, orgId, orgName, isDemo = false, preGeneratedIds = [], onClose, onFinished }) {
  const [enrichData, setEnrichData] = useState({});
  const [loadingIds, setLoadingIds] = useState(new Set());
  const [errorIds, setErrorIds] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queue, setQueue] = useState([]);
  const [logoInfo, setLogoInfo] = useState({ hasLogo: false, variants: [] });
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);
  const [applyDone, setApplyDone] = useState(null);

  const queuedIds = new Set(queue.map((e) => String(e.itemId)));
  const itemList = items.filter((it) => !queuedIds.has(String(it.id)));
  const currentItem = itemList[currentIndex];

  // Fetch logo info once so placeholders know about it
  useEffect(() => {
    if (!orgId) return;
    fetchLogoVariants(orgId)
      .then((variants) => setLogoInfo({ hasLogo: variants.length > 0, variants }))
      .catch(() => setLogoInfo({ hasLogo: false, variants: [] }));
  }, [orgId]);

  const loadCandidates = useCallback(async (item) => {
    if (!item || enrichData[item.id] || loadingIds.has(item.id)) return;
    const hasPreGen = preGeneratedIds.includes(String(item.id));

    if (!hasPreGen) {
      // No pre-generated image: set placeholder immediately, no API call
      setEnrichData((prev) => ({
        ...prev,
        [item.id]: {
          itemId: item.id,
          itemName: item.name,
          categoryName: item.categoryName || "",
          description: "",
          candidates: [],
          hasLogo: logoInfo.hasLogo,
          logoVariants: logoInfo.variants,
        },
      }));
      return;
    }

    setLoadingIds((s) => new Set([...s, item.id]));
    try {
      // Fast load: only fetch pre-generated image + description, skip web search
      const data = await fetchEnrichCandidates(item.id, orgId, orgName, { skipWebSearch: true });
      setEnrichData((prev) => ({ ...prev, [item.id]: data }));
    } catch (err) {
      setErrorIds((prev) => ({ ...prev, [item.id]: err.message }));
    } finally {
      setLoadingIds((s) => { const n = new Set(s); n.delete(item.id); return n; });
    }
  }, [enrichData, loadingIds, orgId, orgName, preGeneratedIds, logoInfo]);

  useEffect(() => {
    if (currentItem) loadCandidates(currentItem);
    const next = itemList[currentIndex + 1];
    if (next) loadCandidates(next);
  }, [currentIndex, currentItem]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQueue = (entry) => {
    const newQueue = [...queue, entry];
    setQueue(newQueue);
    const newQueuedIds = new Set(newQueue.map((e) => String(e.itemId)));
    const remaining = items.filter((it) => !newQueuedIds.has(String(it.id)));
    if (remaining.length === 0 || currentIndex >= remaining.length) {
      setShowConfirmation(true);
    }
    // currentIndex naturally points to the next item since the queued one is removed from itemList
  };

  const handleSkip = () => {
    if (currentIndex >= itemList.length - 1) {
      setShowConfirmation(true);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex((i) => i - 1);
  };

  const handleSearchWeb = useCallback(async (item) => {
    const data = await fetchEnrichCandidates(item.id, orgId, orgName, { skipWebSearch: false });
    setEnrichData((prev) => ({
      ...prev,
      [item.id]: { ...prev[item.id], ...data },
    }));
    return data;
  }, [orgId, orgName]);

  const handleApplyAll = async () => {
    setApplying(true);
    setApplyProgress(0);
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      for (const target of entry.saveTargets) {
        try {
          await applyEnrich(target.id, orgId, {
            imageUrl: entry.imageUrl,
            description: buildDescriptionForVariant(entry.description, entry.itemName, target.name),
            lighting: entry.lighting,
            logoPosition: entry.logoPosition,
            logoScale: entry.logoScale,
            logoVariant: entry.logoVariant,
          });
          succeeded++;
        } catch {
          failed++;
        }
      }
      setApplyProgress(Math.round(((i + 1) / queue.length) * 100));
    }

    setApplyDone({ succeeded, failed });
    setApplying(false);
    onFinished?.();
  };

  // ── Confirmation screen ──────────────────────────────────────────────────────
  if (showConfirmation) {
    return (
      <div className="ew-overlay" onClick={(e) => !applying && !applyDone && e.target === e.currentTarget && onClose()}>
        <div className="ew-modal ew-modal--confirm">
          {!applying && !applyDone && (
            <button className="ew-close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}

          {applyDone ? (
            <div className="ew-finished">
              <p className="ew-finished__icon">✅</p>
              <h2>Done!</h2>
              <p>{applyDone.succeeded} item{applyDone.succeeded !== 1 ? "s" : ""} applied
                {applyDone.failed > 0 && <>, {applyDone.failed} failed</>}.
              </p>
              <button className="ew-btn ew-btn--primary" onClick={onClose}>Close</button>
            </div>
          ) : applying ? (
            <div className="ew-apply-progress">
              <h2>Applying {queue.length} items…</h2>
              <div className="ew-apply-progress__bar">
                <div className="ew-apply-progress__fill" style={{ width: `${applyProgress}%` }} />
              </div>
              <p className="ew-apply-progress__pct">{applyProgress}%</p>
            </div>
          ) : (
            <div className="ew-confirm-body">
              <h2 className="ew-confirm-title">
                {queue.length === 0 ? "Nothing queued" : `Apply ${queue.length} item${queue.length !== 1 ? "s" : ""}?`}
              </h2>
              {queue.length === 0 ? (
                <p style={{ color: "#6b7280", fontSize: 14 }}>
                  You skipped all items. Close the wizard or go back to review.
                </p>
              ) : (
                <div className="ew-queue-grid">
                  {queue.map((entry) => (
                    <div key={entry.itemId} className="ew-queue-card">
                      <img
                        src={proxyImageUrl(entry.thumbUrl || entry.imageUrl)}
                        alt={entry.itemName}
                        className="ew-queue-card__img"
                        onError={(e) => { e.target.style.display = "none"; }}
                      />
                      <p className="ew-queue-card__name">{entry.itemName}</p>
                      {entry.saveTargets.length > 1 && (
                        <span className="ew-queue-card__badge">+{entry.saveTargets.length - 1} variants</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="ew-confirm-actions">
                {itemList.length > 0 && (
                  <button className="ew-btn ew-btn--ghost" onClick={() => setShowConfirmation(false)}>
                    ← Back ({itemList.length} left)
                  </button>
                )}
                <button className="ew-btn ew-btn--ghost" onClick={onClose}>
                  Close without saving
                </button>
                {queue.length > 0 && (
                  <button className="ew-btn ew-btn--primary" onClick={handleApplyAll}>
                    Apply {queue.length} item{queue.length !== 1 ? "s" : ""} →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Empty (all queued, none remaining) — shouldn't normally show but safety net ──
  if (itemList.length === 0) {
    setShowConfirmation(true);
    return null;
  }

  return (
    <div className="ew-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button
        className="ew-nav-arrow ew-nav-arrow--prev"
        onClick={handlePrev}
        disabled={currentIndex === 0}
        aria-label="Previous item"
      >‹</button>
      <button
        className="ew-nav-arrow ew-nav-arrow--next"
        onClick={handleSkip}
        disabled={currentIndex >= itemList.length - 1}
        aria-label="Next item"
      >›</button>

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
              key={currentItem.id}
              item={enrichData[currentItem.id]}
              orgId={orgId}
              hasLogo={logoInfo.hasLogo}
              logoVariants={logoInfo.variants}
              onQueue={handleQueue}
              onSkip={handleSkip}
              onFinish={() => setShowConfirmation(true)}
              stepIndex={currentIndex}
              totalSteps={itemList.length}
              queueLength={queue.length}
              siblingItems={items}
              isDemo={isDemo}
              onSearchWeb={() => handleSearchWeb(currentItem)}
            />
          ) : null}
      </div>
    </div>
  );
}
