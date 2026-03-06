import { NavLink } from "react-router-dom";

export default function BottomTabs() {
  return (
    <nav className="bottom-tabs">
      <NavLink to="/" end className={({ isActive }) => `bottom-tabs__item ${isActive ? "bottom-tabs__item--active" : ""}`}>
        <svg className="bottom-tabs__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
        <span className="bottom-tabs__label">Scenes</span>
      </NavLink>
      <NavLink to="/library" className={({ isActive }) => `bottom-tabs__item ${isActive ? "bottom-tabs__item--active" : ""}`}>
        <svg className="bottom-tabs__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span className="bottom-tabs__label">Library</span>
      </NavLink>
    </nav>
  );
}
