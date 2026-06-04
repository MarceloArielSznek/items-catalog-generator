import { useState, useEffect } from "react";
import { fetchAllFeedback, fetchFeedbackStats, fetchLearningInsights, refineWithOpus, proxyImageUrl } from "../services/enrichApi.js";

const REASON_LABELS = {
  "retail-product": { emoji: "🛍️", label: "Retail / packaging" },
  "not-service":    { emoji: "❌", label: "Not the service" },
  "low-quality":    { emoji: "📸", label: "Low quality" },
  "wrong-context":  { emoji: "🔄", label: "Wrong context" },
  "watermark":      { emoji: "⚠️", label: "Watermark / text" },
  "other":          { emoji: "💭", label: "Other" },
};

function HowItWorksSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="ti-howit">
      <button className="ti-howit__toggle" onClick={() => setOpen((v) => !v)}>
        <span>🤔 How does the training actually work?</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="ti-howit__body">
          <p><strong>What it is:</strong> In-context learning — not model fine-tuning.</p>
          <p>Every time you reject or accept an image, it's saved to <code>feedback.json</code>. On the next search for that item:</p>
          <ol>
            <li>Rejected URLs are <strong>filtered out</strong> so they never appear again</li>
            <li>Rejected thumbnails are <strong>shown to GPT-4o-mini</strong> as "bad examples" — the model scores similar images lower</li>
            <li>The search query and scoring prompt are already tuned to prefer <strong>in-progress service photos</strong> over team/promo shots</li>
          </ol>
          <p><strong>What it doesn't do:</strong> The underlying GPT model itself is not retrained. The improvement comes from better context given to the same model each time.</p>
          <p className="ti-howit__future">💡 <em>Future: Export this feedback data to fine-tune a custom vision model.</em></p>
        </div>
      )}
    </div>
  );
}

function StatCard({ value, label, color }) {
  return (
    <div className="ti-stat" style={{ "--stat-color": color }}>
      <span className="ti-stat__num">{value}</span>
      <span className="ti-stat__label">{label}</span>
    </div>
  );
}

function RejectionReasonBar({ reason, count, total }) {
  const info = REASON_LABELS[reason] || { emoji: "💭", label: reason };
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="ti-reason-row">
      <div className="ti-reason-row__label">
        <span>{info.emoji}</span>
        <span>{info.label}</span>
      </div>
      <div className="ti-reason-row__bar-wrap">
        <div className="ti-reason-row__bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="ti-reason-row__count">{count}×</span>
    </div>
  );
}

function FeedbackLog({ entries }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? entries : entries.slice(0, 20);

  if (entries.length === 0) {
    return (
      <div className="ti-empty">
        <p>No training data yet.</p>
        <p>Click <strong>🎓 Train</strong> to start your first session!</p>
      </div>
    );
  }

  return (
    <div className="ti-log">
      {visible.map((entry) => {
        const reasonInfo = REASON_LABELS[entry.feedbackReason];
        const isAccept = entry.type === "accept";
        const date = new Date(entry.createdAt).toLocaleDateString("en-US", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
        return (
          <div key={entry.id} className={`ti-log-entry ti-log-entry--${entry.type}`}>
            <div className="ti-log-entry__img">
              {entry.imageUrl && (
                <img
                  src={entry.imageUrl.startsWith("/generated") ? entry.imageUrl : proxyImageUrl(entry.imageUrl)}
                  alt=""
                  onError={(e) => { e.target.style.display = "none"; }}
                />
              )}
            </div>
            <div className="ti-log-entry__body">
              <div className="ti-log-entry__top">
                <span className={`ti-log-entry__badge ti-log-entry__badge--${entry.type}`}>
                  {isAccept ? "✅ Accepted" : "👎 Rejected"}
                </span>
                {entry.source === "training" && (
                  <span className="ti-log-entry__source">🎓 training</span>
                )}
                <span className="ti-log-entry__date">{date}</span>
              </div>
              <p className="ti-log-entry__name">{entry.itemName || `Item ${entry.itemId}`}</p>
              {entry.categoryName && (
                <p className="ti-log-entry__cat">{entry.categoryName}</p>
              )}
              {!isAccept && reasonInfo && (
                <p className="ti-log-entry__reason">
                  {reasonInfo.emoji} {reasonInfo.label}
                </p>
              )}
            </div>
          </div>
        );
      })}
      {!showAll && entries.length > 20 && (
        <button className="ti-show-more" onClick={() => setShowAll(true)}>
          Show {entries.length - 20} more entries
        </button>
      )}
    </div>
  );
}

function MaturityBadge({ maturity }) {
  const map = {
    early:   { label: "🌱 Early stage",   color: "#92400e", bg: "#fef3c7" },
    growing: { label: "📈 Growing",        color: "#065f46", bg: "#d1fae5" },
    mature:  { label: "🧠 Well trained",   color: "#1e40af", bg: "#dbeafe" },
  };
  const m = map[maturity] || map.early;
  return (
    <span style={{ background: m.bg, color: m.color, borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>
      {m.label}
    </span>
  );
}

function LearnedDomainRow({ domain, rate, samples, type }) {
  const pct = Math.round(rate * 100);
  const color = type === "trusted" ? "#16a34a" : "#dc2626";
  const bg = type === "trusted" ? "#dcfce7" : "#fee2e2";
  return (
    <div className="ti-learned-row">
      <span className="ti-learned-domain">{domain}</span>
      <span className="ti-learned-bar-wrap">
        <span className="ti-learned-bar" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span style={{ fontSize: 11, color, fontWeight: 700, minWidth: 36 }}>{pct}%</span>
      <span style={{ fontSize: 11, color: "#9ca3af" }}>({samples}×)</span>
    </div>
  );
}

export default function TrainingInsights({ orgId, orgName, onClose }) {
  const [stats, setStats] = useState(null);
  const [entries, setEntries] = useState([]);
  const [learning, setLearning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refining, setRefining] = useState(false);
  const [refineResult, setRefineResult] = useState(null);
  const [refineError, setRefineError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchFeedbackStats(orgId),
      fetchAllFeedback(orgId),
      fetchLearningInsights(orgId),
    ])
      .then(([s, e, l]) => {
        setStats(s);
        setEntries(e);
        setLearning(l);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [orgId]);

  const totalRejections = stats?.rejected || 0;
  const topDomains = stats
    ? Object.entries(stats.topRejectedDomains || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
    : [];

  const reasonEntries = stats
    ? Object.entries(stats.byReason || {}).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="tw-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ti-modal">
        <div className="ti-modal__header">
          <div>
            <h2 className="ti-modal__title">🧠 Training Insights</h2>
            <p className="ti-modal__org">{orgName}</p>
          </div>
          <button className="tw-close" style={{ position: "static" }} onClick={onClose}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="tw-center" style={{ padding: "40px" }}>
            <div className="tw-spinner" />
            <p>Loading training data…</p>
          </div>
        ) : (
          <div className="ti-body">

            {/* Opus 4.8 Refinement panel */}
            <div className="ti-refine-panel">
              <div className="ti-refine-header">
                <div>
                  <p className="ti-refine-title">🔬 Refine with Claude Opus 4.8</p>
                  <p className="ti-refine-sub">
                    Sends your {stats?.total || 0} feedback entries to Opus 4.8 for deep analysis.
                    Generates calibrated scoring rules saved locally — used on every future search.
                  </p>
                </div>
                <button
                  className="ti-refine-btn"
                  disabled={refining || (stats?.total || 0) < 5}
                  onClick={async () => {
                    setRefining(true);
                    setRefineError(null);
                    setRefineResult(null);
                    try {
                      const result = await refineWithOpus(orgId, orgName);
                      setRefineResult(result);
                      // Refresh learning insights
                      const updated = await fetchLearningInsights(orgId);
                      setLearning(updated);
                    } catch (err) {
                      setRefineError(err.message);
                    } finally {
                      setRefining(false);
                    }
                  }}
                  title={(stats?.total || 0) < 5 ? "Need at least 5 feedback entries first" : "Run Opus 4.8 analysis"}
                >
                  {refining ? (
                    <><div className="tw-spinner tw-spinner--sm" /> Analyzing…</>
                  ) : learning?.refinedModel ? (
                    "🔄 Re-refine"
                  ) : (
                    "✨ Refine now"
                  )}
                </button>
              </div>

              {(stats?.total || 0) < 5 && (
                <p className="ti-refine-hint">
                  ⚠ Need {5 - (stats?.total || 0)} more feedback entries to unlock refinement.
                  Do a training session first!
                </p>
              )}

              {refineError && (
                <p className="ti-refine-error">⚠ {refineError}</p>
              )}

              {refineResult && (
                <div className="ti-refine-result">
                  <p className="ti-refine-result__summary">"{refineResult.summary}"</p>
                  <div className="ti-refine-result__stats">
                    <span>🎯 {refineResult.domainsScored} domains scored</span>
                    <span>🚫 {refineResult.blockedDomains?.length || 0} blocked</span>
                    <span>✅ {refineResult.trustedDomains?.length || 0} trusted</span>
                    <span>📊 Confidence: {refineResult.confidenceLevel}</span>
                  </div>
                  <p className="ti-refine-result__tokens">
                    Cost: ~{refineResult.inputTokens + refineResult.outputTokens} tokens
                    (≈ ${(((refineResult.inputTokens * 5) + (refineResult.outputTokens * 25)) / 1_000_000).toFixed(4)})
                  </p>
                </div>
              )}

              {!refineResult && learning?.refinedModel && (
                <div className="ti-refine-result">
                  <p className="ti-refine-result__summary">"{learning.refinedModel.summary}"</p>
                  <div className="ti-refine-result__stats">
                    <span>🎯 Active since {new Date(learning.refinedModel.generatedAt).toLocaleDateString()}</span>
                    <span>🚫 {learning.refinedModel.blockedDomains?.length || 0} blocked</span>
                    <span>✅ {learning.refinedModel.trustedDomains?.length || 0} trusted</span>
                    <span>📊 {learning.refinedModel.confidenceLevel} confidence</span>
                  </div>
                </div>
              )}
            </div>

            <HowItWorksSection />

            {/* Stats row */}
            <div className="ti-stats">
              <StatCard value={stats?.total || 0}    label="Total feedback"  color="#6366f1" />
              <StatCard value={stats?.accepted || 0} label="Accepted ✅"     color="#16a34a" />
              <StatCard value={stats?.rejected || 0} label="Rejected 👎"     color="#dc2626" />
              <StatCard value={new Set(entries.map(e => e.itemId)).size} label="Items trained" color="#0284c7" />
            </div>

            {/* Learning engine status */}
            {learning && (
              <div className="ti-section">
                <h3 className="ti-section__title">
                  🧠 What the system has learned
                  <MaturityBadge maturity={learning.insights?.maturity} />
                </h3>

                {learning.insights?.totalEntries === 0 ? (
                  <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>
                    No patterns learned yet. Start a training session to teach the system your preferences.
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: "0 0 12px" }}>
                      The local scoring engine applies these learned patterns <strong>automatically</strong> on every image search — no API calls needed.
                    </p>

                    {learning.insights?.trusted?.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          ✅ Trusted sources (boosted)
                        </p>
                        {learning.insights.trusted.map((d) => (
                          <LearnedDomainRow key={d.domain} {...d} type="trusted" />
                        ))}
                      </div>
                    )}

                    {learning.insights?.blocked?.length > 0 && (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          🚫 Blocked sources (penalized)
                        </p>
                        {learning.insights.blocked.map((d) => (
                          <LearnedDomainRow key={d.domain} {...d} type="blocked" />
                        ))}
                      </div>
                    )}

                    {learning.insights?.stillLearning > 0 && (
                      <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
                        📊 {learning.insights.stillLearning} more domain{learning.insights.stillLearning !== 1 ? "s" : ""} being tracked (need 3+ samples to apply)
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* No data nudge */}
            {(stats?.total || 0) === 0 && (
              <div className="ti-nudge">
                <p>🎓 You haven't done any training sessions yet.</p>
                <p>Click <strong>Train</strong> to start — it takes ~5 minutes to review 10 items and immediately improves image selection.</p>
              </div>
            )}

            {/* Rejection reasons breakdown */}
            {reasonEntries.length > 0 && (
              <div className="ti-section">
                <h3 className="ti-section__title">Why images get rejected</h3>
                <div className="ti-reasons">
                  {reasonEntries.map(([reason, count]) => (
                    <RejectionReasonBar
                      key={reason}
                      reason={reason}
                      count={count}
                      total={totalRejections}
                    />
                  ))}
                </div>
                <p className="ti-section__note">
                  These patterns are shown to GPT-4o-mini to penalize similar images in future searches.
                </p>
              </div>
            )}

            {/* Top rejected domains */}
            {topDomains.length > 0 && (
              <div className="ti-section">
                <h3 className="ti-section__title">Domains producing bad images</h3>
                <div className="ti-domains">
                  {topDomains.map(([domain, count]) => (
                    <div key={domain} className="ti-domain-chip">
                      <span className="ti-domain-chip__name">{domain}</span>
                      <span className="ti-domain-chip__count">{count} rejected</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Log */}
            <div className="ti-section">
              <h3 className="ti-section__title">
                Training log
                {entries.length > 0 && <span className="ti-section__count">{entries.length} entries</span>}
              </h3>
              <FeedbackLog entries={entries} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
