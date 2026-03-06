const MODE_LABELS = {
  quick: "Quick",
  standard: "Standard",
  premium: "Premium",
};

const FORMAT_LABELS = {
  square: "1:1",
  landscape: "16:9",
  portrait: "4:5",
  story: "9:16",
  banner: "2:1",
};

function formatTime(ms) {
  if (!ms) return null;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function ResultPanel({ result, onReset }) {
  if (!result) return null;

  const imageUrl = result.imageUrl;
  const isStub = result.stub;
  const modeLabel = MODE_LABELS[result.mode] || result.mode;
  const elapsed = formatTime(result.elapsed_ms);

  return (
    <div className="result-panel">
      <div className="result-panel__header">
        <span className="result-panel__title">Generated Result</span>
        <div className="result-panel__badges">
          {isStub && (
            <span className="result-panel__badge result-panel__badge--warn">AI not connected</span>
          )}
          {result.mode && (
            <span className="result-panel__badge">{modeLabel}</span>
          )}
          {result.format && (
            <span className="result-panel__badge">{FORMAT_LABELS[result.format] || result.format}</span>
          )}
          {elapsed && (
            <span className="result-panel__badge">{elapsed}</span>
          )}
        </div>
      </div>

      <div className="result-panel__image-wrap">
        <img
          className="result-panel__image"
          src={imageUrl}
          alt="Generated catalog image"
        />
      </div>

      <div className="result-panel__actions">
        <a
          className="result-panel__download-btn"
          href={imageUrl}
          download={result.filename || "catalog-image.png"}
        >
          ↓ Download
        </a>
        <button className="result-panel__reset-btn" onClick={onReset}>
          Start Over
        </button>
      </div>
    </div>
  );
}
