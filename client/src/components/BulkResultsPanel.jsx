export default function BulkResultsPanel({ results, progress, running, onDownloadAll }) {
  if (results.length === 0 && !running) return null;

  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return (
    <div className="bulk-results">
      {running && (
        <div className="bulk-results__progress">
          <div className="bulk-results__bar">
            <div
              className="bulk-results__bar-fill"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <span className="bulk-results__status">Processing {progress.current} of {progress.total}...</span>
        </div>
      )}

      {!running && results.length > 0 && (
        <div className="bulk-results__summary">
          <span>{successCount} completed{errorCount > 0 ? `, ${errorCount} failed` : ""}</span>
          {successCount > 1 && (
            <button className="btn btn--primary btn--sm" onClick={onDownloadAll}>
              Download All (ZIP)
            </button>
          )}
        </div>
      )}

      <div className="bulk-results__grid">
        {results.map((r, i) => (
          <div key={i} className={`bulk-result-card ${r.status === "error" ? "bulk-result-card--error" : ""}`}>
            {r.status === "success" && r.imageUrl ? (
              <>
                <img className="bulk-result-card__img" src={r.imageUrl} alt={r.originalName} />
                <div className="bulk-result-card__footer">
                  <span className="bulk-result-card__name">{r.originalName}</span>
                  <a className="bulk-result-card__download" href={r.imageUrl} download={r.filename}>↓</a>
                </div>
              </>
            ) : (
              <div className="bulk-result-card__error">
                <span className="bulk-result-card__name">{r.originalName}</span>
                <span className="bulk-result-card__error-msg">{r.error || "Failed"}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
