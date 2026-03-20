import { useEffect, useState } from "react";
import "./loginFormBuilderTheme.css";
import "./LoginPage.css";

export default function LoginPage({
  initialEmail = "",
  initialPassword = "",
  loading,
  error,
  onSubmit,
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);

  useEffect(() => {
    setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    setPassword(initialPassword);
  }, [initialPassword]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    await onSubmit({ email, password });
  };

  return (
    <div className="form-builder-login-scope">
      <div className="login-page">
        <section className="login-page__panel app-card">
          <div className="login-page__intro">
            <span className="app-status__eyebrow">Payload workspace</span>
            <h1 className="login-page__title">Sign in to Catalog Composer</h1>
            <p className="login-page__description">
              Manage items, scenes, and Payload-linked content with the same secure session as the
              form builder. Your token stays in this browser tab only.
            </p>
          </div>

          <form className="login-page__form" onSubmit={handleSubmit}>
            <div className="login-page__field">
              <label className="app-label" htmlFor="catalog-login-email">
                Email
              </label>
              <input
                id="catalog-login-email"
                className="app-input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                required
              />
            </div>

            <div className="login-page__field">
              <label className="app-label" htmlFor="catalog-login-password">
                Password
              </label>
              <input
                id="catalog-login-password"
                className="app-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your Payload password"
                required
              />
              <p className="app-helper">Your session token is stored only for this browser session.</p>
            </div>

            {error ? (
              <div className="app-banner--danger" role="alert">
                {error}
              </div>
            ) : null}

            <div className="login-page__actions">
              <button type="submit" className="app-button" disabled={loading}>
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
