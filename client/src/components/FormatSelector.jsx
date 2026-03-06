const FORMATS = [
  { id: "square",    label: "Square 1:1",     size: "1080 × 1080", desc: "Instagram, social" },
  { id: "landscape", label: "Landscape 16:9", size: "1920 × 1080", desc: "Presentations, web" },
  { id: "portrait",  label: "Portrait 4:5",   size: "1080 × 1350", desc: "Instagram portrait" },
  { id: "story",     label: "Story 9:16",     size: "1080 × 1920", desc: "Stories, Reels" },
  { id: "banner",    label: "Banner 2:1",     size: "1600 × 800",  desc: "Website headers" },
];

export default function FormatSelector({ value, onChange }) {
  return (
    <div className="format-selector">
      <span className="format-selector__label">Output Format</span>
      <div className="format-selector__grid">
        {FORMATS.map((fmt) => (
          <button
            key={fmt.id}
            type="button"
            className={`format-card ${value === fmt.id ? "format-card--active" : ""}`}
            onClick={() => onChange(fmt.id)}
          >
            <div className="format-card__preview" data-ratio={fmt.id} />
            <span className="format-card__label">{fmt.label}</span>
            <span className="format-card__size">{fmt.size}</span>
            <span className="format-card__desc">{fmt.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
