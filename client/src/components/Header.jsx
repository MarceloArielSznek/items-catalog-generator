import { NavLink } from "react-router-dom";

export default function Header() {
  return (
    <header className="header">
      <div className="header__brand">
        <div className="header__logo">OG</div>
        <div className="header__brand-text">
          <span className="header__title">Org Generator</span>
          <span className="header__subtitle">by Menaia</span>
        </div>
      </div>
      <nav className="header__nav">
        <NavLink to="/" end className={({ isActive }) => `header__link ${isActive ? "header__link--active" : ""}`}>
          Orgs
        </NavLink>
        <NavLink to="/items" className={({ isActive }) => `header__link ${isActive ? "header__link--active" : ""}`}>
          Price Book
        </NavLink>
      </nav>
    </header>
  );
}
