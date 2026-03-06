import { NavLink } from "react-router-dom";

export default function Header() {
  return (
    <header className="header">
      <div className="header__brand">
        <div className="header__logo">AP</div>
        <h1 className="header__title">Catalog Composer</h1>
      </div>
      <nav className="header__nav">
        <NavLink to="/" end className={({ isActive }) => `header__link ${isActive ? "header__link--active" : ""}`}>
          Scenes
        </NavLink>
        <NavLink to="/library" className={({ isActive }) => `header__link ${isActive ? "header__link--active" : ""}`}>
          Library
        </NavLink>
      </nav>
    </header>
  );
}
