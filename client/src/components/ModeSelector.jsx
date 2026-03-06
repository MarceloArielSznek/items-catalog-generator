const MODES = [
  {
    id: "quick",
    name: "Quick",
    time: "~5-15 sec",
    cost: "Free",
    description: "Background removal + programmatic composition. No AI costs. Best for high volume.",
    badge: "Fastest",
    badgeColor: "green",
  },
  {
    id: "standard",
    name: "Standard",
    time: "~20-30 sec",
    cost: "~$0.03-0.05",
    description: "Local bg removal + AI refinement for realistic blending. Good balance of cost and quality.",
    badge: "Balanced",
    badgeColor: "blue",
  },
  {
    id: "premium",
    name: "Premium",
    time: "~45-60 sec",
    cost: "~$0.20-0.30",
    description: "Full AI composition with gpt-image-1. Best visual realism. Higher cost per image.",
    badge: "Best quality",
    badgeColor: "purple",
  },
];

export default function ModeSelector({ value, onChange }) {
  return (
    <div className="mode-selector">
      <span className="mode-selector__label">Generation Mode</span>
      <div className="mode-selector__grid">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`mode-card ${value === mode.id ? "mode-card--active" : ""}`}
            onClick={() => onChange(mode.id)}
          >
            <div className="mode-card__header">
              <span className="mode-card__name">{mode.name}</span>
              <span className={`mode-card__badge mode-card__badge--${mode.badgeColor}`}>
                {mode.badge}
              </span>
            </div>
            <p className="mode-card__desc">{mode.description}</p>
            <div className="mode-card__meta">
              <span>{mode.time}</span>
              <span>{mode.cost}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
