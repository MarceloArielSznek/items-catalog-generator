import { useState } from "react";
import { getMenaiaSettings, saveMenaiaSettings } from "../services/menaiaSettings.js";

// Single place to configure the Menaia API credentials. Stored in this browser
// and sent to our server on every request — they are no longer read from .env.
export default function SettingsPage() {
  const initial = getMenaiaSettings();
  const [url, setUrl] = useState(initial.url);
  const [key, setKey] = useState(initial.key);
  const [status, setStatus] = useState(null);

  function handleSave() {
    const saved = saveMenaiaSettings({ url, key });
    setUrl(saved.url);
    setKey(saved.key);
    setStatus("saved");
  }

  return (
    <div className="page settings-page">
      <h1>Settings</h1>

      <div className="section-card">
        <div className="section-card__body">
          <p className="deploy-panel__note">
            Your Menaia API key and base URL live here, in this browser only. They are
            sent to the server with each request — nothing is stored in the server's
            <code> .env</code>. The key is bound to one organization, so anyone deploying
            uses their own key.
          </p>

          <div className="form-row">
            <label className="form-label">Menaia API Base URL</label>
            <input
              className="form-input"
              placeholder="http://localhost:3001"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setStatus(null); }}
            />
          </div>

          <div className="form-row">
            <label className="form-label">Service Account API Key</label>
            <input
              className="form-input form-input--mono"
              type="password"
              placeholder="mk_live_… / mk_test_…"
              value={key}
              onChange={(e) => { setKey(e.target.value); setStatus(null); }}
            />
          </div>

          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={!url.trim() || !key.trim()}
          >
            Save credentials
          </button>
          {status === "saved" && (
            <span className="settings-save-bar__status settings-save-bar__status--ok" style={{ marginLeft: 12 }}>
              Saved to this browser
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
