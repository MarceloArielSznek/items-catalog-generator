import { useState, useRef } from "react";
import { crawlWebsite, generateSeed, parseXlsx } from "../services/seedApi.js";
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
  const [form, setForm] = useState({
    companyName: "",
    companyWebsite: "",
    timezone: "America/Los_Angeles",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.companyName.trim()) return setError("Company name is required");
    if (!form.companyWebsite.trim()) return setError("Website URL is required");
    try { new URL(form.companyWebsite); } catch {
      return setError("Enter a valid URL (e.g. https://example.com)");
    }

    setLoading(true);
    setStatus("Crawling website... (this may take 30–60 seconds)");

    try {
      const result = await crawlWebsite(form.companyWebsite);
      const slug = slugify(form.companyName);
      onNext({
        companyInfo: { ...form, slug, domain: slug },
        extracted: {
          ...result.extracted,
          companyName: form.companyName,
        },
        pagesCount: result.pagesCount,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  return (
    <div className="sg-step">
      <h2>Step 1 — Company Info</h2>
      <p className="sg-step-desc">
        Enter the company details. We'll crawl the website to extract services, branches, and industry data automatically.
      </p>
      <form onSubmit={handleSubmit} className="sg-form">
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
          {loading ? "Crawling..." : "Crawl Website →"}
        </button>
      </form>
    </div>
  );
}

// ── Step 2: Review Extracted Data ────────────────────────────────────────────
function StepReviewExtracted({ data, onNext, onBack }) {
  const { companyInfo, extracted, pagesCount } = data;
  const [branches, setBranches] = useState(
    extracted.branches.length > 0
      ? extracted.branches
      : [{ name: "Main Office", address: "" }]
  );
  const [about, setAbout] = useState(extracted.about);
  const [phone, setPhone] = useState(extracted.phone);
  const [license, setLicense] = useState(extracted.contractorLicense);

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

    onNext({
      ...data,
      extracted: {
        ...extracted,
        about,
        phone,
        contractorLicense: license,
        branches: validBranches,
      },
    });
  };

  return (
    <div className="sg-step">
      <h2>Step 2 — Review Extracted Data</h2>
      <p className="sg-step-desc">
        Crawled <strong>{pagesCount} pages</strong>. Review and edit the extracted information before continuing.
      </p>

      <div className="sg-section">
        <h3>Company Info</h3>
        <div className="sg-info-row">
          <span>Industry:</span><strong>{extracted.industry}</strong>
        </div>
        <div className="sg-info-row">
          <span>Region:</span><strong>{extracted.region}</strong>
        </div>
        <div className="sg-info-row">
          <span>Services found:</span><strong>{extracted.services.length}</strong>
        </div>
      </div>

      <div className="sg-section">
        <h3>Details</h3>
        <label>
          Phone
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="555-555-5555" />
        </label>
        <label>
          Contractor License
          <input type="text" value={license} onChange={(e) => setLicense(e.target.value)} placeholder="CA Lic. #123456" />
        </label>
        <label>
          About
          <textarea rows={3} value={about} onChange={(e) => setAbout(e.target.value)} />
        </label>
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
            <label>
              Name
              <input
                type="text"
                value={branch.name}
                onChange={(e) => updateBranch(i, "name", e.target.value)}
                placeholder="Main Office (HQ)"
              />
            </label>
            <label>
              Address
              <input
                type="text"
                value={branch.address}
                onChange={(e) => updateBranch(i, "address", e.target.value)}
                placeholder="123 Main St, City, CA 90001"
              />
            </label>
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

// ── Step 3: Pricebook Source ─────────────────────────────────────────────────
function StepPricebookTargets({ data, onNext, onBack }) {
  const { extracted } = data;
  const suggested = Math.min(Math.max(extracted.services.length, 6), 8);
  const [mode, setMode] = useState("ai"); // "ai" | "xlsx"

  // AI mode state
  const [targets, setTargets] = useState({
    workAreas: String(suggested),
    itemCategories: String(Math.min(Math.max(extracted.services.length, 8), 12)),
    itemsPerCategory: "5",
  });

  // XLSX mode state
  const fileRef = useRef(null);
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const [xlsxResult, setXlsxResult] = useState(null); // { pricebook, stats, warnings }
  const [xlsxError, setXlsxError] = useState("");

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
      const wa = parseInt(targets.workAreas);
      const ic = parseInt(targets.itemCategories);
      const ipc = parseInt(targets.itemsPerCategory);
      if (isNaN(wa) || wa < 1 || isNaN(ic) || ic < 1 || isNaN(ipc) || ipc < 1) {
        return alert("All targets must be positive numbers");
      }
      onNext({ ...data, targets: { workAreas: wa, itemCategories: ic, itemsPerCategory: ipc }, pricebook: null });
    } else {
      if (!xlsxResult) return alert("Upload and parse an Excel file first");
      onNext({ ...data, targets: null, pricebook: xlsxResult.pricebook });
    }
  };

  return (
    <div className="sg-step">
      <h2>Step 3 — Pricebook Source</h2>
      <p className="sg-step-desc">
        Choose how to build the pricebook: let AI generate it, or upload the client's Excel file.
      </p>

      <div className="sg-mode-toggle">
        <button
          type="button"
          className={mode === "ai" ? "sg-mode-btn sg-mode-btn-active" : "sg-mode-btn"}
          onClick={() => setMode("ai")}
        >
          AI Generation
        </button>
        <button
          type="button"
          className={mode === "xlsx" ? "sg-mode-btn sg-mode-btn-active" : "sg-mode-btn"}
          onClick={() => setMode("xlsx")}
        >
          Upload Excel
        </button>
      </div>

      {mode === "ai" && (
        <div className="sg-form">
          <label>
            Work Areas
            <input
              type="number"
              min="1"
              value={targets.workAreas}
              onChange={(e) => setTargets({ ...targets, workAreas: e.target.value })}
            />
            <span className="sg-hint">Physical zones (Attic, Crawl Space, Exterior, etc.)</span>
          </label>
          <label>
            Item Categories
            <input
              type="number"
              min="1"
              value={targets.itemCategories}
              onChange={(e) => setTargets({ ...targets, itemCategories: e.target.value })}
            />
            <span className="sg-hint">Service groupings within work areas</span>
          </label>
          <label>
            Items per Category
            <input
              type="number"
              min="1"
              value={targets.itemsPerCategory}
              onChange={(e) => setTargets({ ...targets, itemsPerCategory: e.target.value })}
            />
            <span className="sg-hint">Specific line items with pricing (avg)</span>
          </label>
        </div>
      )}

      {mode === "xlsx" && (
        <div className="sg-form">
          <div className="sg-xlsx-upload">
            <p className="sg-hint">
              Upload the client's pricebook Excel file. Expected sheets: <strong>Factors</strong>, <strong>Additional Costs</strong>, <strong>Work Areas</strong>, <strong>Item Categories</strong>, <strong>Items</strong>.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              disabled={xlsxLoading}
              className="sg-file-input"
            />
            {xlsxLoading && <p className="sg-status">Parsing Excel file...</p>}
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
                  <div className="sg-xlsx-warnings">
                    <strong>Warnings:</strong>
                    <ul>
                      {xlsxResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
                <div className="sg-xlsx-areas">
                  {xlsxResult.pricebook.workAreas.map((wa) => (
                    <div key={wa.name} className="sg-xlsx-area">
                      <strong>{wa.name}</strong>
                      <span>{wa.categories.length} categories</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="sg-btn-row">
        <button type="button" className="sg-btn-secondary" onClick={onBack}>← Back</button>
        <button
          type="button"
          className="sg-btn-primary"
          onClick={handleNext}
          disabled={mode === "xlsx" && xlsxLoading}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Role Distribution ────────────────────────────────────────────────
function StepRoleDistribution({ data, onNext, onBack }) {
  const [roles, setRoles] = useState(
    ROLES.map((role) => ({ role, count: ROLE_DEFAULTS[role] ?? 1 }))
  );

  const updateCount = (i, value) => {
    const updated = [...roles];
    updated[i] = { ...updated[i], count: Math.max(0, parseInt(value) || 0) };
    setRoles(updated);
  };

  const handleNext = () => {
    onNext({ ...data, roleDistribution: roles });
  };

  return (
    <div className="sg-step">
      <h2>Step 4 — Role Distribution</h2>
      <p className="sg-step-desc">
        Set how many users to seed per role. These become the initial team members for this organization.
      </p>
      <div className="sg-roles">
        {roles.map((r, i) => (
          <div key={r.role} className="sg-role-row">
            <label>{r.role}</label>
            <input
              type="number"
              min="0"
              value={r.count}
              onChange={(e) => updateCount(i, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="sg-btn-row">
        <button type="button" className="sg-btn-secondary" onClick={onBack}>← Back</button>
        <button type="button" className="sg-btn-primary" onClick={handleNext}>Generate Seed →</button>
      </div>
    </div>
  );
}

// ── Step 5: Generating ───────────────────────────────────────────────────────
function StepGenerating() {
  return (
    <div className="sg-step sg-step-generating">
      <div className="sg-spinner" />
      <h2>Generating seed file...</h2>
      <p>AI is generating the pricebook. This usually takes 30–90 seconds.</p>
    </div>
  );
}

function buildDevMessage(result, companyInfo) {
  const varName =
    result.slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + "Organization";

  return `Here's the seed file for **${companyInfo.companyName}**.

File: \`${result.slug}.ts\`

**Steps:**

1. Copy the file to \`apps/web/scripts/seed/utils/orgs/${result.slug}.ts\`

2. In \`apps/web/scripts/seed/utils/orgs/index.ts\` add these 3 lines:

\`\`\`ts
// With the other imports at the top:
import { ${varName} } from './${result.slug}';

// In the re-exports:
export { ${varName} } from './${result.slug}';

// In the organizationsData array:
${varName},
\`\`\`

3. Run the seed for this org.

Generated pricebook stats:
- ${result.stats.workAreas} work areas
- ${result.stats.categories} categories
- ${result.stats.items} items
- ${result.stats.factors} factors
- ${result.stats.vehicles} vehicles

(To test locally before pushing to prod: \`npx tsx src/deploy.ts\` in tools/seed-generator and select "From file")`;
}

// ── Step 6: Result ───────────────────────────────────────────────────────────
function StepResult({ result, companyInfo, onReset }) {
  const [tab, setTab] = useState("message");
  const [copied, setCopied] = useState(false);

  const devMessage = buildDevMessage(result, companyInfo);

  const tabContent = {
    message: devMessage,
    ts: result.content,
    ledger: result.ledger,
  };

  const tabFilename = {
    message: `${result.slug}-instructions.txt`,
    ts: `${result.slug}.ts`,
    ledger: `${result.slug}.ledger.txt`,
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(tabContent[tab]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const blob = new Blob([tabContent[tab]], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = tabFilename[tab];
    a.click();
  };

  const handleDownloadTs = () => {
    const blob = new Blob([result.content], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${result.slug}.ts`;
    a.click();
  };

  return (
    <div className="sg-step sg-step-result">
      <div className="sg-result-header">
        <div>
          <h2>✓ Seed generated for <em>{companyInfo.companyName}</em></h2>
          <div className="sg-stats">
            <span>{result.stats.workAreas} work areas</span>
            <span>{result.stats.categories} categories</span>
            <span>{result.stats.items} items</span>
            <span>{result.stats.factors} factors</span>
            <span>{result.stats.vehicles} vehicles</span>
          </div>
        </div>
        <div className="sg-result-actions">
          <button className="sg-btn-secondary" onClick={handleCopy}>
            {copied ? "Copied!" : "Copy"}
          </button>
          <button className="sg-btn-secondary" onClick={handleDownload}>Download</button>
          <button className="sg-btn-download-ts" onClick={handleDownloadTs}>⬇ {result.slug}.ts</button>
          <button className="sg-btn-primary" onClick={onReset}>New Seed</button>
        </div>
      </div>

      <div className="sg-tabs">
        <button
          className={tab === "message" ? "sg-tab sg-tab-active" : "sg-tab"}
          onClick={() => setTab("message")}
        >
          📨 Dev Instructions
        </button>
        <button
          className={tab === "ts" ? "sg-tab sg-tab-active" : "sg-tab"}
          onClick={() => setTab("ts")}
        >
          {result.slug}.ts
        </button>
        <button
          className={tab === "ledger" ? "sg-tab sg-tab-active" : "sg-tab"}
          onClick={() => setTab("ledger")}
        >
          Source Ledger
        </button>
      </div>

      <pre className={`sg-code${tab === "message" ? " sg-code-message" : ""}`}>
        {tabContent[tab]}
      </pre>
    </div>
  );
}

// ── Main Wizard ──────────────────────────────────────────────────────────────
export default function SeedGeneratorPage() {
  const [step, setStep] = useState(1);
  const [wizardData, setWizardData] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleStep1 = (data) => {
    setWizardData(data);
    setStep(2);
  };

  const handleStep2 = (data) => {
    setWizardData(data);
    setStep(3);
  };

  const handleStep3 = (data) => {
    setWizardData(data);
    setStep(4);
  };

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
      roleDistribution,
      branches: extracted.branches,
    };

    try {
      const generated = await generateSeed(input, extracted, pricebook);
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
          <h1>Seed Generator</h1>
          <p>Generate a seed file for a new organization to hand off to your Attic Tech developer.</p>
        </div>

        {typeof step === "number" && step < 5 && (
          <div className="sg-progress">
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`sg-progress-step ${step >= s ? "sg-progress-active" : ""}`}>
                <div className="sg-progress-dot">{s}</div>
                <span>{["Company", "Review", "Targets", "Roles"][s - 1]}</span>
              </div>
            ))}
          </div>
        )}

        {error && step !== "generating" && (
          <div className="sg-error-banner">
            <strong>Error:</strong> {error}
          </div>
        )}

        {step === 1 && <StepCompanyInfo onNext={handleStep1} />}
        {step === 2 && (
          <StepReviewExtracted
            data={wizardData}
            onNext={handleStep2}
            onBack={() => setStep(1)}
          />
        )}
        {step === 3 && (
          <StepPricebookTargets
            data={wizardData}
            onNext={handleStep3}
            onBack={() => setStep(2)}
          />
        )}
        {step === 4 && (
          <StepRoleDistribution
            data={wizardData}
            onNext={handleStep4}
            onBack={() => setStep(3)}
          />
        )}
        {step === "generating" && <StepGenerating />}
        {step === "result" && result && (
          <StepResult
            result={result}
            companyInfo={wizardData.companyInfo}
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  );
}
