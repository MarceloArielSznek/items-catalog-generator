import { useState } from "react";
import {
  getMenaiaSettings,
  saveMenaiaSettings,
  hasMenaiaSettings,
  hasDemoDataSettings,
} from "../services/menaiaSettings.js";

// Single place to configure the Menaia API credentials. Stored in this browser
// and sent to our server on every request — they are no longer read from .env.
export default function SettingsPage() {
  const initial = getMenaiaSettings();
  const [url, setUrl] = useState(initial.url);
  const [key, setKey] = useState(initial.key);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState(null);

  // Demo-data population config (Supabase auth + Payload REST host).
  const [supabaseUrl, setSupabaseUrl] = useState(initial.supabaseUrl);
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(initial.supabaseAnonKey);
  const [payloadUrl, setPayloadUrl] = useState(initial.payloadUrl);
  const [showAnon, setShowAnon] = useState(false);
  const [demoStatus, setDemoStatus] = useState(null);

  const connected = hasMenaiaSettings();
  const demoConnected = hasDemoDataSettings();
  const canSave = Boolean(url.trim() && key.trim());
  const canSaveDemo = Boolean(supabaseUrl.trim() && supabaseAnonKey.trim() && payloadUrl.trim());

  function handleChange(setter) {
    return (e) => {
      setter(e.target.value);
      setStatus(null);
    };
  }

  function handleDemoChange(setter) {
    return (e) => {
      setter(e.target.value);
      setDemoStatus(null);
    };
  }

  function handleSave() {
    const saved = saveMenaiaSettings({ url, key, supabaseUrl, supabaseAnonKey, payloadUrl });
    setUrl(saved.url);
    setKey(saved.key);
    setStatus("saved");
  }

  function handleSaveDemo() {
    const saved = saveMenaiaSettings({ url, key, supabaseUrl, supabaseAnonKey, payloadUrl });
    setSupabaseUrl(saved.supabaseUrl);
    setSupabaseAnonKey(saved.supabaseAnonKey);
    setPayloadUrl(saved.payloadUrl);
    setDemoStatus("saved");
  }

  return (
    <div className="page conn-settings">
      <div className="page-header">
        <div>
          <h1 className="page__title">Settings</h1>
          <p className="page__description">
            Configure how this app connects to Menaia.
          </p>
        </div>
      </div>

      <div className="conn-card">
        <div className="conn-card__header">
          <div className="conn-card__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <div className="conn-card__heading">
            <h2 className="conn-card__title">Menaia Connection</h2>
            <p className="conn-card__subtitle">Service account credentials</p>
          </div>
          <span
            className={`conn-pill ${connected ? "conn-pill--ok" : "conn-pill--off"}`}
          >
            <span className="conn-pill__dot" />
            {connected ? "Connected" : "Not configured"}
          </span>
        </div>

        <div className="conn-card__body">
          <p className="conn-note">
            These credentials live <strong>in this browser only</strong> and are sent
            to the server with each request — nothing is stored in the server's
            <code> .env</code>. The key is bound to one organization, so anyone
            deploying uses their own key.
          </p>

          <div className="form-row">
            <label className="form-label" htmlFor="menaia-url">
              Menaia API Base URL
            </label>
            <input
              id="menaia-url"
              className="form-input"
              placeholder="http://localhost:3001"
              value={url}
              onChange={handleChange(setUrl)}
            />
            <span className="form-hint">
              The root URL of your Menaia instance — no trailing slash.
            </span>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="menaia-key">
              Service Account API Key
            </label>
            <div className="conn-input-group">
              <input
                id="menaia-key"
                className="form-input form-input--mono"
                type={showKey ? "text" : "password"}
                placeholder="mk_live_… / mk_test_…"
                value={key}
                onChange={handleChange(setKey)}
              />
              <button
                type="button"
                className="conn-reveal"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <span className="form-hint">
              Stored locally and never displayed in logs.
            </span>
          </div>
        </div>

        <div className="conn-card__footer">
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={!canSave}
          >
            Save credentials
          </button>
          {status === "saved" && (
            <span className="conn-saved">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Saved to this browser
            </span>
          )}
        </div>
      </div>

      <div className="conn-card">
        <div className="conn-card__header">
          <div className="conn-card__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14a9 3 0 0 0 18 0V5" />
              <path d="M3 12a9 3 0 0 0 18 0" />
            </svg>
          </div>
          <div className="conn-card__heading">
            <h2 className="conn-card__title">Demo Data</h2>
            <p className="conn-card__subtitle">Post-deploy population (avatars + leads)</p>
          </div>
          <span
            className={`conn-pill ${demoConnected ? "conn-pill--ok" : "conn-pill--off"}`}
          >
            <span className="conn-pill__dot" />
            {demoConnected ? "Connected" : "Not configured"}
          </span>
        </div>

        <div className="conn-card__body">
          <p className="conn-note">
            Populating demo records (user avatars + leads) signs in as a real org
            admin via <strong>Supabase</strong> to reach the Payload REST + avatar
            APIs the service key can't. These also live in this browser only.
          </p>

          <div className="form-row">
            <label className="form-label" htmlFor="supabase-url">
              Supabase URL
            </label>
            <input
              id="supabase-url"
              className="form-input"
              placeholder="http://127.0.0.1:54321"
              value={supabaseUrl}
              onChange={handleDemoChange(setSupabaseUrl)}
            />
            <span className="form-hint">GoTrue/Supabase host — no trailing slash.</span>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="supabase-anon">
              Supabase Anon / Publishable Key
            </label>
            <div className="conn-input-group">
              <input
                id="supabase-anon"
                className="form-input form-input--mono"
                type={showAnon ? "text" : "password"}
                placeholder="sb_publishable_… / eyJ…"
                value={supabaseAnonKey}
                onChange={handleDemoChange(setSupabaseAnonKey)}
              />
              <button
                type="button"
                className="conn-reveal"
                onClick={() => setShowAnon((v) => !v)}
                aria-label={showAnon ? "Hide key" : "Show key"}
              >
                {showAnon ? "Hide" : "Show"}
              </button>
            </div>
            <span className="form-hint">Public client key used only for the password grant.</span>
          </div>

          <div className="form-row">
            <label className="form-label" htmlFor="payload-url">
              Payload / Web URL
            </label>
            <input
              id="payload-url"
              className="form-input"
              placeholder="http://127.0.0.1:3000"
              value={payloadUrl}
              onChange={handleDemoChange(setPayloadUrl)}
            />
            <span className="form-hint">
              The Next/Payload host that serves <code>/api/&lt;collection&gt;</code> — usually
              the same as the Menaia URL in production.
            </span>
          </div>
        </div>

        <div className="conn-card__footer">
          <button
            className="btn btn--primary"
            onClick={handleSaveDemo}
            disabled={!canSaveDemo}
          >
            Save demo-data config
          </button>
          {demoStatus === "saved" && (
            <span className="conn-saved">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              Saved to this browser
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
