const POSITIONS = [
  { id: "top-left",      label: "↖" },
  { id: "top-center",    label: "↑" },
  { id: "top-right",     label: "↗" },
  { id: "middle-left",   label: "←" },
  { id: "middle-center", label: "•" },
  { id: "middle-right",  label: "→" },
  { id: "bottom-left",   label: "↙" },
  { id: "bottom-center", label: "↓" },
  { id: "bottom-right",  label: "↘" },
];

export default function LogoPositionGrid({ value, onChange }) {
  return (
    <div className="logo-position">
      <span className="logo-position__label">Logo Position</span>
      <div className="logo-position__grid">
        {POSITIONS.map((pos) => (
          <button
            key={pos.id}
            type="button"
            className={`logo-position__cell ${value === pos.id ? "logo-position__cell--active" : ""}`}
            onClick={() => onChange(pos.id)}
            title={pos.id.replace("-", " ")}
          >
            {pos.label}
          </button>
        ))}
      </div>
    </div>
  );
}
