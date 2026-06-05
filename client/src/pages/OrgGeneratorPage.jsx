import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { crawlWebsite, crawlDemo, generateSeed, parseXlsx } from "../services/seedApi.js";
import { setLogoPlaceholder } from "../services/orgApi.js";
import "../styles/SeedGeneratorPage.css";

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/New_York", label: "Eastern (New York)" },
];

const ROLES = [
  "Admin",
  "Ops Manager",
  "Sales Admin",
  "Sales Member",
  "Client Coordinator",
  "Crew Leader",
  "Crew Member",
];

const ROLE_DEFAULTS = {
  Admin: 2,
  "Ops Manager": 2,
  "Sales Admin": 1,
  "Sales Member": 3,
  "Client Coordinator": 1,
  "Crew Leader": 4,
  "Crew Member": 8,
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Step 1: Company Info ─────────────────────────────────────────────────────
function StepCompanyInfo({ onNext }) {
  const [mode, setMode] = useState("real"); // "real" | "demo"
  const [form, setForm] = useState({
    companyName: "",
    companyWebsite: "",
    timezone: "America/Los_Angeles",
  });
  const [demoUrls, setDemoUrls] = useState([""]);
  const [demoBranchCount, setDemoBranchCount] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const addUrl = () => setDemoUrls([...demoUrls, ""]);
  const removeUrl = (i) => setDemoUrls(demoUrls.filter((_, idx) => idx !== i));
  const updateUrl = (i, value) => {
    const updated = [...demoUrls];
    updated[i] = value;
    setDemoUrls(updated);
  };

  const submitReal = async () => {
    if (!form.companyName.trim()) return setError("Company name is required");
    if (!form.companyWebsite.trim()) return setError("Website URL is required");
    try { new URL(form.companyWebsite); } catch {
      return setError("Enter a valid URL (e.g. https://example.com)");
    }

    setLoading(true);
    setStatus("Crawling website… (30–60 seconds)");
    try {
      const result = await crawlWebsite(form.companyWebsite);
      const slug = slugify(form.companyName);
      onNext({
        companyInfo: { ...form, slug, domain: slug, isDemo: false },
        extracted: { ...result.extracted, companyName: form.companyName },
        pagesCount: result.pagesCount,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  const submitDemo = async () => {
    const urls = demoUrls.map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) return setError("Add at least one company URL");
    for (const u of urls) {
      try { new URL(u); } catch { return setError(`Invalid URL: ${u}`); }
    }

    setLoading(true);
    setStatus(`Crawling ${urls.length} site${urls.length > 1 ? "s" : ""} and inventing a demo identity… (1–2 min)`);
    try {
      const result = await crawlDemo(urls, demoBranchCount);
      const slug = result.slug || slugify(result.extracted.companyName);
      onNext({
        companyInfo: {
          companyName: result.extracted.companyName,
          companyWebsite: "", // empty → org is flagged source:'demo'
          slug,
          domain: result.identity?.domain || slug,
          timezone: form.timezone,
          isDemo: true,
        },
        extracted: result.extracted,
        pagesCount: (result.sourcesUsed || []).reduce((s, x) => s + (x.pagesCount || 0), 0),
        demoMeta: {
          sourcesUsed: result.sourcesUsed || [],
          failures: result.failures || [],
          serviceCount: result.serviceCount,
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");
    if (mode === "real") submitReal();
    else submitDemo();
  };

  return (
    <div className="sg-step">
      <h2>Step 1 — Source</h2>
      <p className="sg-step-desc">
        Build from one real company, or generate a fake demo org from one or more company sites in an industry.
      </p>

      <div className="sg-mode-toggle">
        <button type="button" className={mode === "real" ? "sg-mode-btn sg-mode-btn-active" : "sg-mode-btn"} onClick={() => { setMode("real"); setError(""); }}>🏢 Real client</button>
        <button type="button" className={mode === "demo" ? "sg-mode-btn sg-mode-btn-active" : "sg-mode-btn"} onClick={() => { setMode("demo"); setError(""); }}>🎭 Industry / Company demo</button>
      </div>

      <form onSubmit={handleSubmit} className="sg-form">
        {mode === "real" && (
          <>
            <label>
              Company Name
              <input
                type="text"
                placeholder="Attic Pros LLC"
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                disabled={loading}
              />
            </label>
            <label>
              Website URL
              <input
                type="url"
                placeholder="https://atticpros.com"
                value={form.companyWebsite}
                onChange={(e) => setForm({ ...form, companyWebsite: e.target.value })}
                disabled={loading}
              />
            </label>
          </>
        )}

        {mode === "demo" && (
          <div className="sg-section">
            <h3>Company sites</h3>
            <p className="sg-hint">Add one site (company demo) or several from the same industry (industry demo). The AI merges their services and invents a fake company name + logo.</p>
            {demoUrls.map((url, i) => (
              <div key={i} className="sg-branch">
                <div className="sg-branch-header">
                  <span>Site {i + 1}</span>
                  {demoUrls.length > 1 && (
                    <button type="button" className="sg-btn-danger-sm" onClick={() => removeUrl(i)} disabled={loading}>Remove</button>
                  )}
                </div>
                <input
                  type="url"
                  placeholder="https://competitor.com"
                  value={url}
                  onChange={(e) => updateUrl(i, e.target.value)}
                  disabled={loading}
                />
              </div>
            ))}
            <button type="button" className="sg-btn-secondary" onClick={addUrl} disabled={loading}>+ Add Site</button>

            <label className="sg-branch-count">
              Fake branches to create
              <input
                type="number"
                min="1"
                max="10"
                value={demoBranchCount}
                onChange={(e) => setDemoBranchCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                disabled={loading}
              />
              <span className="sg-label-optional">AI invents fake names, addresses, phone & license</span>
            </label>
          </div>
        )}

        <label>
          Timezone
          <select
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            disabled={loading}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </label>

        {error && <p className="sg-error">{error}</p>}
        {status && <p className="sg-status">{status}</p>}
        <button type="submit" disabled={loading} className="sg-btn-primary">
          {loading ? "Crawling…" : mode === "real" ? "Crawl Website →" : "Build Demo Source →"}
        </button>
      </form>
    </div>
  );
}

// ── Step 2: Review Extracted Data ────────────────────────────────────────────
function StepReviewExtracted({ data, onNext, onBack }) {
  const { companyInfo, extracted, pagesCount, demoMeta } = data;
  const isDemo = companyInfo.isDemo;
  const [branches, setBranches] = useState(
    extracted.branches.length > 0
      ? extracted.branches
      : [{ name: "Main Office", address: isDemo ? "123 Demo Street, Demo City, CA 90001" : "" }]
  );
  const [about, setAbout] = useState(extracted.about);
  const [phone, setPhone] = useState(extracted.phone);
  const [license, setLicense] = useState(extracted.contractorLicense);
  const [industry, setIndustry] = useState(extracted.industry || "");
  const [region, setRegion] = useState(extracted.region || "");

  const addBranch = () => setBranches([...branches, { name: "", address: "" }]);
  const removeBranch = (i) => setBranches(branches.filter((_, idx) => idx !== i));
  const updateBranch = (i, field, value) => {
    const updated = [...branches];
    updated[i] = { ...updated[i], [field]: value };
    setBranches(updated);
  };

  const handleNext = () => {
    const validBranches = branches.filter((b) => b.name.trim() && b.address.trim());
    if (validBranches.length === 0) return alert("At least one branch with name and address is required");
    if (!industry.trim()) return alert("Industry is required");
    if (!region.trim()) return alert("Region is required");
    onNext({ ...data, extracted: { ...extracted, industry: industry.trim(), region: region.trim(), about, phone, contractorLicense: license, branches: validBranches } });
  };

  return (
    <div className="sg-step">
      <h2>Step 2 — Review Extracted Data</h2>
      <p className="sg-step-desc">
        Crawled <strong>{pagesCount} pages</strong>
        {isDemo && demoMeta ? <> from <strong>{demoMeta.sourcesUsed.length} site{demoMeta.sourcesUsed.length !== 1 ? "s" : ""}</strong></> : null}. Review and edit the extracted information.
      </p>

      {isDemo && (
        <div className="sg-demo-banner">
          🎭 <strong>Demo org</strong> — fake company “{companyInfo.companyName}” generated from the sites below. No real contact info; you'll generate a fake logo next.
          {demoMeta?.failures?.length > 0 && (
            <div className="sg-demo-failures">⚠ {demoMeta.failures.length} site(s) failed to crawl and were skipped.</div>
          )}
        </div>
      )}

      <div className="sg-section">
        <h3>Company Info</h3>
        <div className="sg-info-row"><span>Services found:</span><strong>{extracted.services.length}</strong></div>
        <label>Industry<input type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="HVAC, insulation, roofing..." /></label>
        <label>Region<input type="text" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Southern California, Greater Austin..." /></label>
      </div>

      <div className="sg-section">
        <h3>Details</h3>
        <label>Phone<input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-555-5555" /></label>
        <label>Contractor License<input type="text" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="CA Lic. #123456" /></label>
        <label>About<textarea rows={3} value={about} onChange={(e) => setAbout(e.target.value)} /></label>
      </div>

      <div className="sg-section">
        <h3>Branches</h3>
        {branches.map((branch, i) => (
          <div key={i} className="sg-branch">
            <div className="sg-branch-header">
              <span>Branch {i + 1}</span>
              {branches.length > 1 && (
                <button type="button" className="sg-btn-danger-sm" onClick={() => removeBranch(i)}>Remove</button>
              )}
            </div>
            <label>Name<input type="text" value={branch.name} onChange={(e) => updateBranch(i, "name", e.target.value)} placeholder="Main Office (HQ)" /></label>
            <label>Address<input type="text" value={branch.address} onChange={(e) => updateBranch(i, "address", e.target.value)} placeholder="123 Main St, City, CA 90001" /></label>
          </div>
        ))}
        <button type="button" className="sg-btn-secondary" onClick={addBranch}>+ Add Branch</button>
      </div>

      <div className="sg-btn-row">
        <button type="button" className="sg-btn-secondary" onClick={onBack}>← Back</button>
        <button type="button" className="sg-btn-primary" onClick={handleNext}>Next →</button>
      </div>
    </div>
  );
}

const ITEM_PRESETS = [
  { label: "Small (40)", value: 40 },
  { label: "Standard (60)", value: 60 },
  { label: "Large (100)", value: 100 },
  { label: "Full (150)", value: 150 },
];

// ── Step 3: Catalog Configuration ───────────────────────────────────────────
function StepPricebookTargets({ data, onNext, onBack }) {
  const [mode, setMode] = useState("ai");
  const [totalItems, setTotalItems] = useState(60);
  const [industryContext, setIndustryContext] = useState("");
  const fileRef = useRef(null);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [xlsxResult, setXlsxResult] = useState(null);
  const [xlsxError, setXlsxError] = useState("");

  // Derived distribution preview
  const catCount = Math.max(4, Math.round(totalItems / 5));
  const ipc = Math.round(totalItems / catCount);
  const waCount = Math.max(3, Math.min(8, Math.round(catCount / 2)));

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setXlsxError("");
    setXlsxResult(null);
    setXlsxLoading(true);
    try {
      const result = await parseXlsx(file);
      setXlsxResult(result);
    } catch (err) {
      setXlsxError(err.message);
    } finally {
      setXlsxLoading(false);
    }
  };

  const handleNext = () => {
    if (mode === "ai") {
      if (!totalItems || totalItems < 10) return alert("Minimum 10 items");
      onNext({
        ...data,
        targets: { totalItems },
        industryContext: industryContext.trim() || null,
        pricebook: null,
      });
    } else {
      if (!xlsxResult) return alert("Upload and parse an Excel file first");
      onNext({ ...data, targets: null, industryContext: null, pricebook: xlsxResult.pricebook });
    }
  };

  return (
    <div className="sg-step">
      <h2>Step 3 — Catalog Configuration</h2>
      <p className="sg-step-desc">
        Tell the AI how many items to generate. It will figure out the optimal work areas, categories, and distribution for this specific company.
      </p>

      <div className="sg-mode-toggle">
        <button type="button" className={mode === "ai" ? "sg-mode-btn sg-mode-btn-active" : "sg-mode-btn"} onClick={() => setMode("ai")}>AI Generation</button>
        <button type="button" className={mode === "xlsx" ? "sg-mode-btn sg-mode-btn-active" : "sg-mode-btn"} onClick={() => setMode("xlsx")}>Upload Excel</button>
      </div>

      {mode === "ai" && (
        <div className="sg-form">
          <div className="sg-item-count-section">
            <label className="sg-label">Total Items</label>
            <div className="sg-preset-row">
              {ITEM_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={`sg-preset-btn ${totalItems === p.value ? "sg-preset-btn--active" : ""}`}
                  onClick={() => setTotalItems(p.value)}
                >
                  {p.label}
                </button>
              ))}
              <input
                type="number"
                min="10"
                max="300"
                value={totalItems}
                onChange={(e) => setTotalItems(Math.max(10, parseInt(e.target.value) || 10))}
                className="sg-count-input"
              />
            </div>
            <div className="sg-distribution-preview">
              AI will create <strong>~{waCount} work areas</strong> · <strong>~{catCount} categories</strong> · <strong>~{ipc} items each</strong>
            </div>
          </div>

          <label className="sg-label-block">
            Additional Industry Context
            <span className="sg-label-optional">optional</span>
            <textarea
              rows={4}
              className="sg-textarea"
              placeholder={`Describe anything extra that will help generate a more accurate catalog.\n\nExamples:\n• "Focus on residential attic insulation and crawl space encapsulation"\n• "This is a demo for a high-end HVAC company serving commercial buildings"\n• "Emphasize energy efficiency upgrades and rebate-eligible services"`}
              value={industryContext}
              onChange={(e) => setIndustryContext(e.target.value)}
            />
          </label>
        </div>
      )}

      {mode === "xlsx" && (
        <div className="sg-form">
          <div className="sg-xlsx-upload">
            <p className="sg-hint">Expected sheets: <strong>Factors, Additional Costs, Work Areas, Item Categories, Items</strong></p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} disabled={xlsxLoading} className="sg-file-input" />
            {xlsxLoading && <p className="sg-status">Parsing…</p>}
            {xlsxError && <p className="sg-error">{xlsxError}</p>}
            {xlsxResult && (
              <div className="sg-xlsx-preview">
                <div className="sg-xlsx-stats">
                  <span>{xlsxResult.stats.workAreas} work areas</span>
                  <span>{xlsxResult.stats.categories} categories</span>
                  <span>{xlsxResult.stats.items} items</span>
                  <span>{xlsxResult.stats.factors} factors</span>
                </div>
                {xlsxResult.warnings.length > 0 && (
                  <div className="sg-xlsx-warnings"><strong>Warnings:</strong><ul>{xlsxResult.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="sg-btn-row">
        <button type="button" className="sg-btn-secondary" onClick={onBack}>← Back</button>
        <button type="button" className="sg-btn-primary" onClick={handleNext} disabled={mode === "xlsx" && xlsxLoading}>Next →</button>
      </div>
    </div>
  );
}

// ── Step 4: Role Distribution ────────────────────────────────────────────────
function StepRoleDistribution({ data, onNext, onBack }) {
  const [roles, setRoles] = useState(ROLES.map((role) => ({ role, count: ROLE_DEFAULTS[role] ?? 1 })));

  const updateCount = (i, value) => {
    const updated = [...roles];
    updated[i] = { ...updated[i], count: Math.max(0, parseInt(value) || 0) };
    setRoles(updated);
  };

  return (
    <div className="sg-step">
      <h2>Step 4 — Role Distribution</h2>
      <p className="sg-step-desc">Set how many users to seed per role.</p>
      <div className="sg-roles">
        {roles.map((r, i) => (
          <div key={r.role} className="sg-role-row">
            <label>{r.role}</label>
            <input type="number" min="0" value={r.count} onChange={(e) => updateCount(i, e.target.value)} />
          </div>
        ))}
      </div>
      <div className="sg-btn-row">
        <button type="button" className="sg-btn-secondary" onClick={onBack}>← Back</button>
        <button type="button" className="sg-btn-primary" onClick={() => onNext({ ...data, roleDistribution: roles })}>Generate Org →</button>
      </div>
    </div>
  );
}

// ── Step 5: Generating ───────────────────────────────────────────────────────
function StepGenerating() {
  return (
    <div className="sg-step sg-step-generating">
      <div className="sg-spinner" />
      <h2>Generating org…</h2>
      <p>AI is building the full org configuration. This usually takes 30–90 seconds.</p>
    </div>
  );
}

// ── Step 6: Result ───────────────────────────────────────────────────────────
function StepResult({ result, companyInfo, onReset, onViewOrg }) {
  const [tab, setTab] = useState("overview");
  const [copied, setCopied] = useState(false);

  const ledgerContent = result.ledger || "";

  const handleCopyLedger = () => {
    navigator.clipboard.writeText(ledgerContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const { org, stats } = result;

  return (
    <div className="sg-step sg-step-result">
      <div className="sg-result-header">
        <div>
          <h2>✓ Org generated: <em>{companyInfo.companyName}</em></h2>
          <div className="sg-stats">
            <span>{stats.branches} {stats.branches === 1 ? "branch" : "branches"}</span>
            <span>{stats.categories} categories</span>
            <span>{stats.items} items</span>
            <span>{stats.workAreas} work areas</span>
            <span>{stats.factors} factors</span>
          </div>
        </div>
        <div className="sg-result-actions">
          <button className="sg-btn-primary sg-btn-view-org" onClick={onViewOrg}>
            View Org →
          </button>
          <button className="sg-btn-secondary" onClick={onReset}>New Org</button>
        </div>
      </div>

      <div className="sg-tabs">
        <button className={tab === "overview" ? "sg-tab sg-tab-active" : "sg-tab"} onClick={() => setTab("overview")}>Overview</button>
        <button className={tab === "ledger" ? "sg-tab sg-tab-active" : "sg-tab"} onClick={() => setTab("ledger")}>Source Ledger</button>
      </div>

      {tab === "overview" && org && (
        <div className="sg-overview">
          <div className="sg-overview-section">
            <h4>Branches ({org.branches.length})</h4>
            {org.branches.map((b) => (
              <div key={b.name} className="sg-overview-row">
                <strong>{b.name}</strong> — {b.address}
              </div>
            ))}
          </div>
          <div className="sg-overview-section">
            <h4>Categories ({org.resources.categories.length})</h4>
            {org.resources.categories.map((c) => (
              <div key={c.name} className="sg-overview-row">
                <strong>{c.name}</strong> — {c.items.length} items
              </div>
            ))}
          </div>
          <div className="sg-overview-section">
            <h4>Work Areas ({org.resources.workAreas.length})</h4>
            <div className="sg-pills">
              {org.resources.workAreas.map((wa) => (
                <span key={wa.name} className="sg-pill">{wa.name}</span>
              ))}
            </div>
          </div>
          <div className="sg-overview-section">
            <h4>Users ({org.users.length})</h4>
            <div className="sg-pills">
              {[...new Set(org.users.map((u) => u.role))].map((role) => {
                const count = org.users.filter((u) => u.role === role).length;
                return <span key={role} className="sg-pill">{count}× {role}</span>;
              })}
            </div>
          </div>
        </div>
      )}

      {tab === "ledger" && (
        <div className="sg-ledger-wrapper">
          <div className="sg-ledger-toolbar">
            <button className="sg-btn-secondary" onClick={handleCopyLedger}>{copied ? "Copied!" : "Copy"}</button>
          </div>
          <pre className="sg-code">{ledgerContent}</pre>
        </div>
      )}
    </div>
  );
}

// ── Main Wizard ──────────────────────────────────────────────────────────────
export default function OrgGeneratorPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [wizardData, setWizardData] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleStep4 = async (data) => {
    setWizardData(data);
    setStep("generating");
    setError("");

    const { companyInfo, extracted, targets, roleDistribution, pricebook } = data;
    const input = {
      companyName: companyInfo.companyName,
      companyWebsite: companyInfo.companyWebsite,
      slug: companyInfo.slug,
      domain: companyInfo.domain,
      timezone: companyInfo.timezone,
      targets,
      industryContext: data.industryContext || null,
      roleDistribution,
      branches: extracted.branches,
    };

    try {
      const generated = await generateSeed(input, extracted, pricebook);
      // Demo orgs start with a clean "Your Logo" placeholder.
      if (companyInfo.isDemo) {
        try { await setLogoPlaceholder(generated.slug); } catch { /* non-blocking */ }
      }
      setResult(generated);
      setStep("result");
    } catch (err) {
      setError(err.message);
      setStep(4);
    }
  };

  const handleReset = () => {
    setStep(1);
    setWizardData({});
    setResult(null);
    setError("");
  };

  return (
    <div className="sg-page">
      <div className="sg-container">
        <div className="sg-header">
          <button className="sg-back-link" onClick={() => navigate("/")}>← Back to Orgs</button>
          <h1>New Org Generator</h1>
          <p>Generate a complete org configuration from a website or industry template.</p>
        </div>

        {typeof step === "number" && step < 5 && (
          <div className="sg-progress">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`sg-progress-step ${step >= s ? "sg-progress-active" : ""}`}>
                <div className="sg-progress-dot">{s}</div>
                <span>{["Company", "Review", "Pricebook", "Roles"][s - 1]}</span>
              </div>
            ))}
          </div>
        )}

        {error && step !== "generating" && (
          <div className="sg-error-banner"><strong>Error:</strong> {error}</div>
        )}

        {step === 1 && <StepCompanyInfo onNext={(d) => { setWizardData(d); setStep(2); }} />}
        {step === 2 && <StepReviewExtracted data={wizardData} onNext={(d) => { setWizardData(d); setStep(3); }} onBack={() => setStep(1)} />}
        {step === 3 && <StepPricebookTargets data={wizardData} onNext={(d) => { setWizardData(d); setStep(4); }} onBack={() => setStep(2)} />}
        {step === 4 && <StepRoleDistribution data={wizardData} onNext={handleStep4} onBack={() => setStep(3)} />}
        {step === "generating" && <StepGenerating />}
        {step === "result" && result && (
          <StepResult
            result={result}
            companyInfo={wizardData.companyInfo}
            onReset={handleReset}
            onViewOrg={() => navigate(`/orgs/${result.slug}`)}
          />
        )}
      </div>
    </div>
  );
}
