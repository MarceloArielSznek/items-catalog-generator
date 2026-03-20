import { NavLink, useNavigate } from "react-router-dom";
import { clearToken, getStoredToken } from "../services/payloadAuth.js";

export default function Header() {
  const navigate = useNavigate();
  const hasPayloadSession = Boolean(getStoredToken());

  const handleSignOut = () => {
    clearToken();
    if (import.meta.env.PROD) {
      navigate("/login", { replace: true });
    }
  };

  return (
    <header className="header">
      <div className="header__brand">
        <div className="header__logo">AP</div>
        <h1 className="header__title">Catalog Composer</h1>
      </div>
      <nav className="header__nav">
        <NavLink to="/items" className={({ isActive }) => `header__link ${isActive ? "header__link--active" : ""}`}>
          Items
        </NavLink>
        <NavLink to="/" end className={({ isActive }) => `header__link ${isActive ? "header__link--active" : ""}`}>
          Scenes
        </NavLink>
        <NavLink to="/service-photos" className={({ isActive }) => `header__link ${isActive ? "header__link--active" : ""}`}>
          Service Photos
        </NavLink>
        <NavLink to="/library" className={({ isActive }) => `header__link ${isActive ? "header__link--active" : ""}`}>
          Library
        </NavLink>
        {hasPayloadSession ? (
          <button type="button" className="header__link btn btn--ghost btn--sm" onClick={handleSignOut}>
            Sign out
          </button>
        ) : null}
      </nav>
    </header>
  );
}
