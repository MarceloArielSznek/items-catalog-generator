import { useState, useEffect, useCallback, useRef } from "react";
import { fetchTrainingItems, fetchEnrichCandidates, saveFeedbackBatch, fetchFeedbackStats, proxyImageUrl, generateEnrichImage } from "../services/enrichApi.js";

const REJECT_REASONS = [
  { id: "retail-product",  emoji: "🛍️", label: "Retail / packaging" },
  { id: "not-service",     emoji: "❌", label: "Not the service" },
  { id: "low-quality",     emoji: "📸", label: "Low quality" },
  { id: "wrong-context",   emoji: "🔄", label: "Wrong context" },
  { id: "watermark",       emoji: "⚠️", label: "Watermark / text" },
];

const AI_OFFER_AFTER = 3; // rejections before AI offer appears

// ── AI Generation Panel ───────────────────────────────────────────────────────

function AIGeneratePanel({ item, onGenerated, onSkip }) {
  const [prompt, setPrompt] = useState(
    `Professional photo of "${item.name}" service at a residential home, real job site, no text, no logos`
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    // Auto-focus and select all so user can immediately type
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await generateEnrichImage(item.id, {
        itemName: item.name,
        categoryName: item.categoryName,
        description: prompt,
      });
      onGenerated({ url: result.url, thumbUrl: result.url, isAI: true });
    } catch (err) {
      setError(err.message);
      setGenerating(false);
    }
  };

  return (
    <div className="tw-ai-panel">
      <div className="tw-ai-panel__header">
        <span className="tw-ai-panel__badge">✨ AI</span>
        <p className="tw-ai-panel__title">None of those worked.<br/>Let's generate one.</p>
        <p className="tw-ai-panel__sub">Describe the perfect image for this item:</p>
      </div>

      <textarea
        ref={textareaRef}
        className="tw-ai-panel__textarea"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        placeholder="e.g. Attic insulation being installed by a technician in protective gear..."
        disabled={generating}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
        }}
      />
      <p className="tw-ai-panel__hint">⌘↵ to generate</p>

      {error && <p className="tw-ai-panel__error">⚠ {error}</p>}

      <div className="tw-ai-panel__actions">
        <button className="tw-btn tw-btn--ghost" onClick={onSkip} disabled={generating}>
          Skip item
        </button>
        <button
          className="tw-btn tw-btn--ai"
          onClick={handleGenerate}
          disabled={generating || !prompt.trim()}
        >
          {generating ? (
            <><div className="tw-spinner tw-spinner--sm" /> Generating…</>
          ) : (
            <>✨ Generate image</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Single Card ───────────────────────────────────────────────────────────────

function TrainingCard({ item, orgId, orgName, onDecision, cardIndex, totalCards }) {
  const [candidates, setCandidates] = useState([]);
  const [currentCandIdx, setCurrentCandIdx] = useState(0);
  const [rejectCount, setRejectCount] = useState(0);
  const [showAIOffer, setShowAIOffer] = useState(false);
  const [aiImage, setAiImage] = useState(null);         // generated image
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showRejectReasons, setShowRejectReasons] = useState(false);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setCurrentCandIdx(0);
    setRejectCount(0);
    setShowAIOffer(false);
    setAiImage(null);
    setShowRejectReasons(false);

    fetchEnrichCandidates(item.id, orgId, orgName)
      .then((data) => setCandidates(data.candidates || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [item.id, orgId, orgName]);

  // Current image is either an AI-generated one or the next Serper candidate
  const currentImage = aiImage || candidates[currentCandIdx];

  const handleAccept = () => {
    if (!currentImage || deciding) return;
    setDeciding(true);
    onDecision({
      type: "accept",
      itemId: item.id,
      itemName: item.name,
      categoryName: item.categoryName,
      imageUrl: currentImage.url,
    });
  };

  const handleReject = (reason) => {
    if (!currentImage || deciding) return;

    onDecision({
      type: "reject",
      itemId: item.id,
      itemName: item.name,
      categoryName: item.categoryName,
      imageUrl: currentImage.url,
      feedbackReason: reason,
    });

    const nextRejectCount = rejectCount + 1;
    setRejectCount(nextRejectCount);
    setShowRejectReasons(false);

    const hasMoreCandidates = currentCandIdx < candidates.length - 1;

    // After AI_OFFER_AFTER rejections, show AI panel (regardless of remaining candidates)
    if (nextRejectCount >= AI_OFFER_AFTER) {
      setAiImage(null); // clear any previous AI image
      setShowAIOffer(true);
    } else if (hasMoreCandidates) {
      setCurrentCandIdx((i) => i + 1);
    } else {
      // No more candidates and under threshold — show AI offer anyway
      setShowAIOffer(true);
    }
  };

  const handleSkip = () => {
    setDeciding(true);
    onDecision({ type: "skip", itemId: item.id, itemName: item.name });
  };

  const handleAIGenerated = (generatedImage) => {
    setAiImage(generatedImage);
    setShowAIOffer(false);
  };

  return (
    <div className="tw-card">
      {/* Progress */}
      <div className="tw-card__progress">
        <span className="tw-card__counter">{cardIndex + 1} / {totalCards}</span>
        <div className="tw-card__progress-bar">
          <div
            className="tw-card__progress-fill"
            style={{ width: `${(cardIndex / totalCards) * 100}%` }}
          />
        </div>
      </div>

      {/* Item info */}
      <div className="tw-card__meta">
        <span className="tw-card__category">{item.categoryName}</span>
        <h3 className="tw-card__name">{item.name}</h3>
        {!showAIOffer && candidates.length > 1 && !aiImage && (
          <span className="tw-card__cand-counter">
            Image {currentCandIdx + 1} of {candidates.length}
            {rejectCount > 0 && <span className="tw-card__reject-tally"> · {rejectCount} rejected</span>}
          </span>
        )}
        {aiImage && <span className="tw-card__cand-counter">✨ AI-generated image</span>}
      </div>

      {/* AI Offer Panel — shown instead of image */}
      {showAIOffer ? (
        <AIGeneratePanel
          item={item}
          onGenerated={handleAIGenerated}
          onSkip={handleSkip}
        />
      ) : (
        <>
          {/* Image */}
          <div className="tw-card__image-wrap">
            {loading ? (
              <div className="tw-card__loader">
                <div className="tw-spinner" />
                <p>Finding images…</p>
              </div>
            ) : error ? (
              <div className="tw-card__error">
                <p>⚠ {error}</p>
                <button className="tw-btn tw-btn--ghost" onClick={handleSkip}>Skip</button>
              </div>
            ) : !currentImage ? (
              <div className="tw-card__error">
                <p>No images found</p>
                <button className="tw-btn tw-btn--ghost" onClick={() => setShowAIOffer(true)}>
                  ✨ Generate with AI
                </button>
              </div>
            ) : (
              <>
                {aiImage && <span className="tw-card__ai-badge">✨ AI</span>}
                <img
                  key={currentImage.url}
                  src={currentImage.isAI ? currentImage.url : proxyImageUrl(currentImage.url)}
                  alt={item.name}
                  className="tw-card__image"
                  onError={(e) => { e.target.src = currentImage.thumbUrl || currentImage.url; }}
                />
              </>
            )}
          </div>

          {/* Actions */}
          {!loading && currentImage && !deciding && (
            <>
              {showRejectReasons ? (
                <div className="tw-reject-reasons">
                  <p className="tw-reject-title">Why is this wrong?</p>
                  <div className="tw-reject-grid">
                    {REJECT_REASONS.map((r) => (
                      <button
                        key={r.id}
                        className="tw-reject-btn"
                        onClick={() => handleReject(r.id)}
                      >
                        <span>{r.emoji}</span>
                        <span>{r.label}</span>
                      </button>
                    ))}
                  </div>
                  <button className="tw-btn tw-btn--ghost tw-btn--sm" onClick={() => setShowRejectReasons(false)}>
                    ← Back
                  </button>
                </div>
              ) : (
                <div className="tw-card__actions">
                  <button className="tw-btn tw-btn--reject" onClick={() => setShowRejectReasons(true)}>
                    <span>👎</span> Not this one
                  </button>
                  <button className="tw-btn tw-btn--accept" onClick={handleAccept}>
                    <span>✅</span> Looks good!
                  </button>
                </div>
              )}
              <button className="tw-card__skip-link" onClick={handleSkip}>
                Skip item →
              </button>
            </>
          )}

          {deciding && (
            <div className="tw-card__deciding">
              <div className="tw-spinner tw-spinner--sm" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Summary Screen ────────────────────────────────────────────────────────────

function TrainingSummary({ decisions, orgId, onClose }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    fetchFeedbackStats(orgId).then(setStats).catch(() => {});
  }, [orgId]);

  const accepted = decisions.filter((d) => d.type === "accept").length;
  const rejected = decisions.filter((d) => d.type === "reject").length;
  const skipped  = decisions.filter((d) => d.type === "skip").length;

  const reasonCounts = {};
  decisions.filter((d) => d.type === "reject").forEach((d) => {
    const label = REJECT_REASONS.find((r) => r.id === d.feedbackReason)?.label || d.feedbackReason;
    reasonCounts[label] = (reasonCounts[label] || 0) + 1;
  });

  return (
    <div className="tw-summary">
      <div className="tw-summary__icon">🎓</div>
      <h2 className="tw-summary__title">Training Complete!</h2>
      <p className="tw-summary__subtitle">
        The model has learned your preferences for this session.
      </p>

      <div className="tw-summary__stats">
        <div className="tw-stat tw-stat--accept">
          <span className="tw-stat__num">{accepted}</span>
          <span className="tw-stat__label">Approved</span>
        </div>
        <div className="tw-stat tw-stat--reject">
          <span className="tw-stat__num">{rejected}</span>
          <span className="tw-stat__label">Rejected</span>
        </div>
        <div className="tw-stat tw-stat--skip">
          <span className="tw-stat__num">{skipped}</span>
          <span className="tw-stat__label">Skipped</span>
        </div>
      </div>

      {Object.keys(reasonCounts).length > 0 && (
        <div className="tw-summary__reasons">
          <p className="tw-summary__section-title">Top rejection reasons</p>
          {Object.entries(reasonCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([label, count]) => (
              <div key={label} className="tw-reason-row">
                <span>{label}</span>
                <span className="tw-reason-count">{count}×</span>
              </div>
            ))}
        </div>
      )}

      {stats && (
        <div className="tw-summary__lifetime">
          <p className="tw-summary__section-title">All-time training data</p>
          <p className="tw-summary__lifetime-line">
            📊 {stats.total} total feedback entries &nbsp;·&nbsp; {stats.accepted} accepted &nbsp;·&nbsp; {stats.rejected} rejected
          </p>
        </div>
      )}

      <button className="tw-btn tw-btn--primary tw-btn--full" onClick={onClose}>
        Done — improve my enrichments! 🚀
      </button>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function TrainingWizard({ orgId, orgName, onClose }) {
  const [phase, setPhase] = useState("loading"); // loading | training | saving | done
  const [items, setItems] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [decisions, setDecisions] = useState([]); // all accept/reject/skip events
  const [error, setError] = useState(null);

  // Load random items on mount
  useEffect(() => {
    fetchTrainingItems(orgId, 10)
      .then((data) => {
        setItems(data);
        setPhase("training");
      })
      .catch((err) => {
        setError(err.message);
        setPhase("error");
      });
  }, [orgId]);

  const handleDecision = useCallback((decision) => {
    // Accumulate every decision (including mid-item reject+try-next)
    if (decision.type !== "skip") {
      setDecisions((prev) => [...prev, { ...decision, source: "training" }]);
    }

    // Advance to next item when user accepts OR skips OR runs out of candidates
    if (decision.type === "accept" || decision.type === "skip") {
      setCurrentIdx((idx) => {
        const next = idx + 1;
        if (next >= items.length) {
          // All items done — save batch then show summary
          setPhase("saving");
          return idx;
        }
        return next;
      });
    }
  }, [items.length]);

  // When we enter "saving" phase, flush feedback batch
  useEffect(() => {
    if (phase !== "saving") return;

    const toSave = decisions.map((d) => ({
      type: d.type,
      source: "training",
      itemId: d.itemId,
      orgId,
      itemName: d.itemName,
      categoryName: d.categoryName,
      imageUrl: d.imageUrl,
      feedbackReason: d.feedbackReason || null,
    })).filter((d) => d.imageUrl); // only entries with a real image URL

    if (toSave.length === 0) {
      setPhase("done");
      return;
    }

    saveFeedbackBatch(toSave)
      .then(() => setPhase("done"))
      .catch((err) => {
        console.error("Failed to save feedback batch:", err);
        setPhase("done"); // show summary anyway
      });
  }, [phase]); // eslint-disable-line

  const currentItem = items[currentIdx];

  return (
    <div className="tw-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tw-modal">
        <button className="tw-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Loading */}
        {phase === "loading" && (
          <div className="tw-center">
            <div className="tw-spinner" />
            <p>Picking 10 random items for training…</p>
          </div>
        )}

        {/* Error */}
        {phase === "error" && (
          <div className="tw-center">
            <p style={{ color: "#dc2626" }}>⚠ {error}</p>
            <button className="tw-btn tw-btn--ghost" onClick={onClose}>Close</button>
          </div>
        )}

        {/* Training cards */}
        {phase === "training" && currentItem && (
          <TrainingCard
            key={currentItem.id}
            item={currentItem}
            orgId={orgId}
            orgName={orgName}
            onDecision={handleDecision}
            cardIndex={currentIdx}
            totalCards={items.length}
          />
        )}

        {/* Saving */}
        {phase === "saving" && (
          <div className="tw-center">
            <div className="tw-spinner" />
            <p>Saving training data…</p>
          </div>
        )}

        {/* Done */}
        {phase === "done" && (
          <TrainingSummary
            decisions={decisions}
            orgId={orgId}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}
