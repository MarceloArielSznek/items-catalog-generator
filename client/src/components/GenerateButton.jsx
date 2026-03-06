export default function GenerateButton({ canGenerate, loading, onClick }) {
  let className = "generate-btn";
  let label = "Generate Catalog Image";

  if (loading) {
    className += " generate-btn--loading";
    label = "Generating…";
  } else if (canGenerate) {
    className += " generate-btn--ready";
  } else {
    className += " generate-btn--disabled";
    label = "Upload all 3 images to generate";
  }

  return (
    <button
      className={className}
      disabled={!canGenerate || loading}
      onClick={onClick}
    >
      {loading && <span className="generate-btn__spinner" />}
      {label}
    </button>
  );
}
