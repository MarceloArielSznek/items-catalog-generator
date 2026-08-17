import { useState, useRef, useEffect } from "react";
import {
  connect,
  fetchBranches,
  previewSimulation,
  runSimulation,
} from "../services/simulationApi.js";
import "../styles/SimulationPage.css";

/**
 * A local Supabase always exposes the same gateway and publishable key — the
 * values are identical on every `supabase start`, so the local presets can
 * fill them in. Production's project URL and key are per-environment and are
 * left for the operator to paste.
 */
const LOCAL_SUPABASE = {
  url: "http://127.0.0.1:54321",
  anonKey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
};

const PRESETS = [
  { label: "Production", value: "https://api.menaia.com" },
  { label: "Local :3003", value: "http://localhost:3003", supabase: LOCAL_SUPABASE },
  { label: "Local :3001", value: "http://localhost:3001", supabase: LOCAL_SUPABASE },
];

const STORAGE_KEY = "simulation.connection";

/** Mirrors FUNNEL_RATES in simulationService.js — kept in sync deliberately. */
const RATES = { visitsPerLead: 0.5, soldPerVisit: 0.5, invoicedPerSale: 0.6 };

function deriveFunnel(leads) {
  const count = Math.max(0, Math.round(Number(leads) || 0));
  const visits = Math.round(count * RATES.visitsPerLead);
  const sold = Math.round(visits * RATES.soldPerVisit);
  return { leads: count, visits, sold, invoices: Math.round(sold * RATES.invoicedPerSale) };
}

/**
 * Rough write count, from observed runs (~7 writes per lead once visits,
 * estimates, shifts, hours, comments and expenses are counted).
 *
 * Duration is dominated by the API's rate limit — 100 requests per minute per
 * user — not by how fast anything runs, so the estimate is simply the request
 * count divided by that ceiling.
 */
function estimateWork(leads) {
  const writes = Math.round(leads * 7);
  return { writes, minutes: Math.max(1, Math.ceil(writes / 100)) };
}

/** Everything except the password is safe to remember between visits. */
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export default function SimulationPage() {
  const saved = loadSaved();
  const [apiBase, setApiBase] = useState(saved.apiBase || PRESETS[0].value);
  const [supabaseUrl, setSupabaseUrl] = useState(saved.supabaseUrl || "");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(saved.supabaseAnonKey || "");
  const [email, setEmail] = useState(saved.email || "");
  const [password, setPassword] = useState("");

  const [organizations, setOrganizations] = useState([]);
  const [organizationId, setOrganizationId] = useState("");
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState(null);

  const [leads, setLeads] = useState(20);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [summary, setSummary] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ apiBase, supabaseUrl, supabaseAnonKey, email }),
    );
  }, [apiBase, supabaseUrl, supabaseAnonKey, email]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // Refresh the per-person plan whenever the org, branch or lead count moves.
  // Debounced so typing a lead count doesn't fire a request per keystroke.
  useEffect(() => {
    if (!organizationId) {
      setPreview(null);
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const result = await previewSimulation(credentialsRef.current, {
          organizationId: Number(organizationId),
          branchId: branchId ? Number(branchId) : null,
          leads,
        });
        setPreview(result);
        setPreviewError(null);
      } catch (err) {
        setPreview(null);
        setPreviewError(err.message);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [organizationId, branchId, leads]);

  /**
   * Switching target also switches the Supabase project it authenticates
   * against — they have to move together, or a local token gets sent to
   * production and 401s. Presets that know their Supabase fill it in.
   */
  function applyPreset(preset) {
    setApiBase(preset.value);
    if (preset.supabase) {
      setSupabaseUrl(preset.supabase.url);
      setSupabaseAnonKey(preset.supabase.anonKey);
    }
  }

  const credentials = { apiBase, supabaseUrl, supabaseAnonKey, email, password };
  const isProd = /api\.menaia\.com/i.test(apiBase);

  // The preview effect must not re-fire on every keystroke in a credential
  // field, so it reads them through a ref rather than as dependencies.
  const credentialsRef = useRef(credentials);
  credentialsRef.current = credentials;

  async function handleConnect() {
    setBusy(true);
    setStatus({ kind: "info", text: "Signing in…" });
    try {
      const { organizations: orgs, email: who } = await connect(credentials);
      setOrganizations(orgs);
      // A single membership needs no choosing — the common, correct setup.
      const only = orgs.length === 1 ? String(orgs[0].id) : "";
      setOrganizationId(only);
      setStatus({ kind: "ok", text: `Signed in as ${who} — ${orgs.length} organization(s)` });
      if (only) await loadBranches(only);
    } catch (err) {
      setOrganizations([]);
      setBranches([]);
      setStatus({ kind: "err", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function loadBranches(orgId) {
    try {
      const { organizationName, branches: list } = await fetchBranches(credentials, Number(orgId));
      setBranches(list);
      setBranchId("");
      setStatus({ kind: "ok", text: `${organizationName}: ${list.length} branch(es)` });
    } catch (err) {
      setBranches([]);
      setStatus({ kind: "err", text: err.message });
    }
  }

  async function handleRun(commit) {
    // Deliberately not window.confirm: the in-app browser pane suppresses
    // native dialogs and returns false, which silently cancelled every commit.
    if (commit && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setLog([]);
    setSummary(null);
    try {
      const result = await runSimulation(
        {
          ...credentials,
          organizationId: Number(organizationId),
          branchId: branchId ? Number(branchId) : null,
          commit,
          leads,
        },
        (step) => setLog((prev) => [...prev, step]),
      );
      setSummary({ ...result.summary, mutations: result.mutations, commit: result.commit });
    } catch (err) {
      setLog((prev) => [...prev, { kind: "err", text: err.message }]);
    } finally {
      setBusy(false);
    }
  }

  const funnel = deriveFunnel(leads);
  const work = estimateWork(funnel.leads);
  const canRun = Boolean(organizationId) && !busy && funnel.leads > 0;

  return (
    <div className="sim-page">
      <header className="sim-head">
        <h1>Operational Simulation</h1>
        <p>
          Drives the real funnel — lead → visit → estimate → sold → job → shifts →
          worked hours → close — through the same API the app uses.
        </p>
      </header>

      <div className="sim-grid">
        <div className="sim-col">
          <section className="sim-card">
            <h2>Target</h2>
            <div className="sim-presets">
              {PRESETS.map((p) => (
                <button key={p.value} type="button" onClick={() => applyPreset(p)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className={`sim-badge ${isProd ? "prod" : ""}`}>
              {isProd ? `PRODUCTION — ${apiBase}` : apiBase || "—"}
            </div>
            <label>
              <span>API base</span>
              <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} />
            </label>
            <label>
              <span>Supabase URL</span>
              <input
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxx.supabase.co"
              />
            </label>
            <label>
              <span>Supabase anon key</span>
              <input
                value={supabaseAnonKey}
                onChange={(e) => setSupabaseAnonKey(e.target.value)}
              />
            </label>
          </section>

          <section className="sim-card">
            <h2>User</h2>
            <p className="sim-hint">
              A user login, not the app&apos;s API key: no OAuth scope can write
              estimates or jobs, so a service account cannot run this.
            </p>
            <label>
              <span>Email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </label>
            <button className="sim-connect" type="button" onClick={handleConnect} disabled={busy}>
              Connect &amp; load organizations
            </button>
            {status && <p className={`sim-status ${status.kind}`}>{status.text}</p>}
            <div className="sim-row">
              <label>
                <span>Organization</span>
                <select
                  value={organizationId}
                  disabled={!organizations.length}
                  onChange={(e) => {
                    setOrganizationId(e.target.value);
                    if (e.target.value) loadBranches(e.target.value);
                  }}
                >
                  <option value="">— connect first —</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.id})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Branch</span>
                <select
                  value={branchId}
                  disabled={!branches.length}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  <option value="">— first available —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.id})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="sim-card">
            <h2>Volume</h2>
            <label>
              <span>How many leads?</span>
              <input
                type="number"
                min="1"
                value={leads}
                onChange={(e) => setLeads(Number(e.target.value || 0))}
              />
            </label>
            <div className="sim-presets">
              {[20, 50, 100, 250].map((n) => (
                <button key={n} type="button" onClick={() => setLeads(n)}>
                  {n}
                </button>
              ))}
            </div>

            <ol className="sim-derived">
              <li>
                <span>Leads created</span>
                <b>{funnel.leads}</b>
              </li>
              <li>
                <span>Book a visit</span>
                <b>{funnel.visits}</b>
              </li>
              <li>
                <span>Sell (job created)</span>
                <b>{funnel.sold}</b>
              </li>
              <li>
                <span>Get invoiced</span>
                <b>{funnel.invoices}</b>
              </li>
            </ol>

            <p className="sim-funnel">
              The rest follows on its own: {Math.max(0, funnel.leads - funnel.visits)} leads
              scatter across your lead statuses, {Math.max(0, funnel.visits - funnel.sold)}{" "}
              estimates end up lost or still open, and each sold job lands somewhere in the
              pipeline — some closed, some mid-production — based on how far back it sold.
              Shifts, worked hours, comments, expenses, reviews and calendar entries come
              with it.
            </p>
            <p className="sim-hint">
              ≈ {work.writes.toLocaleString()} requests, roughly {work.minutes} min
              {work.minutes > 10 ? " — leave it running" : ""}. The API allows 100
              requests per minute, so the run is paced to stay under that.
            </p>
          </section>

          {confirming ? (
            <div className="sim-confirm">
              <p>
                Write <b>{funnel.leads} leads</b> ({funnel.sold} of them sold, {funnel.invoices}{" "}
                invoiced) into{" "}
                <b>
                  {organizations.find((o) => String(o.id) === String(organizationId))?.name}
                </b>{" "}
                on <b>{isProd ? "PRODUCTION" : apiBase}</b>?
              </p>
              <div className="sim-actions">
                <button type="button" className="cancel" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button type="button" className="commit" onClick={() => handleRun(true)}>
                  Yes, write it
                </button>
              </div>
            </div>
          ) : (
            <div className="sim-actions">
              <button
                type="button"
                className="dry"
                onClick={() => handleRun(false)}
                disabled={!canRun}
              >
                Dry run
              </button>
              <button
                type="button"
                className="commit"
                onClick={() => handleRun(true)}
                disabled={!canRun}
              >
                Run &amp; commit
              </button>
            </div>
          )}
        </div>

        <div className="sim-col">
          {(preview || previewError) && (
            <section className="sim-card">
              <h2>Who does what</h2>
              {previewError && <p className="sim-status err">{previewError}</p>}
              {preview && (
                <>
                  {preview.fellBackToEveryone?.sales && (
                    <p className="sim-status err">
                      No Sales Member or Sales Admin in this branch — leads will be
                      spread across everyone.
                    </p>
                  )}
                  {preview.fellBackToEveryone?.crew && (
                    <p className="sim-status err">
                      No Crew Leader or Crew Member in this branch — shifts will be
                      spread across everyone.
                    </p>
                  )}

                  <h3 className="sim-people-head">Sales · {preview.sales.length}</h3>
                  <table className="sim-people">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Role</th>
                        <th>Leads</th>
                        <th>Visits</th>
                        <th>Sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sales.map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td className="muted">{p.role}</td>
                          <td>{p.leads}</td>
                          <td>{p.visits}</td>
                          <td>{p.sales}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <h3 className="sim-people-head">Crew · {preview.crew.length}</h3>
                  <table className="sim-people">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Role</th>
                        <th>Shift days</th>
                        <th>As lead</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.crew.map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td className="muted">{p.role}</td>
                          <td>{p.shiftDays}</td>
                          <td>{p.leadsCrew}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <p className="sim-hint">
                    Assignment is round-robin and deterministic, so this is exactly what
                    the run will do. Hours per shift vary — they are derived from each
                    estimate&apos;s labor budget.
                  </p>
                </>
              )}
            </section>
          )}

          <section className="sim-card sim-output">
            <h2>Output</h2>
          <pre ref={logRef} className="sim-log">
            {log.length === 0
              ? "Connect, pick an organization, then run. A dry run validates credentials, the organization guard and reference data without writing anything."
              : log
                  .map((s) => (s.kind === "stage" ? `\n${s.text}` : `  ${s.text}`))
                  .join("\n")}
          </pre>
          {summary && (
            <div className="sim-summary">
              <h3>{summary.commit ? "Run complete" : "Dry run complete — nothing written"}</h3>
              <ul>
                {Object.entries(summary)
                  .filter(([k]) => k !== "commit")
                  .map(([k, v]) => (
                    <li key={k}>
                      <span>{k}</span>
                      <b>{String(v)}</b>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          </section>
        </div>
      </div>
    </div>
  );
}
