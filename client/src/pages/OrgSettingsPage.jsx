import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getOrg,
  updateOrgSettings,
  updateOrgResources,
  uploadItemImage,
  deleteItemImage,
  generateItemImage,
  bulkGenerateImages,
  fetchItemCandidates,
  selectItemImage,
  editItemImage,
  suggestImageStyle,
  listOrgLogos,
  uploadOrgLogo,
  deleteOrgLogo,
  bulkApplyOrgLogo,
  listLogoSources,
  importOrgLogo,
  improveItemDescriptions,
  generateProposalContent,
  updateOrgUsers,
  generateUserIdentities,
  generateUserAvatar,
  uploadUserAvatar,
  deleteUserAvatar,
  bulkGenerateUserAvatars,
} from "../services/orgApi.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function SaveBar({ dirty, saving, status, onSave, onDiscard }) {
  if (!dirty && !status) return null;
  return (
    <div className="settings-save-bar">
      {status === "saved" && <span className="settings-save-bar__status settings-save-bar__status--ok">Changes saved</span>}
      {status === "error" && <span className="settings-save-bar__status settings-save-bar__status--err">Save failed</span>}
      {dirty && (
        <>
          <button className="btn btn--secondary" onClick={onDiscard} disabled={saving}>Discard</button>
          <button className="btn btn--primary" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </>
      )}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="settings-field">
      <div className="settings-field__label">{label}</div>
      {hint && <div className="settings-field__hint">{hint}</div>}
      <div className="settings-field__control">{children}</div>
    </div>
  );
}

function Card({ title, description, children }) {
  return (
    <div className="settings-card">
      <div className="settings-card__head">
        <h3 className="settings-card__title">{title}</h3>
        {description && <p className="settings-card__desc">{description}</p>}
      </div>
      <div className="settings-card__body">{children}</div>
    </div>
  );
}

// ── Organization Panel ────────────────────────────────────────────────────────

function OrganizationPanel({ org, onSaved }) {
  const [form, setForm] = useState({
    name: org.name || "",
    industry: org.industry || "",
    region: org.region || "",
    timezone: org.timezone || "",
    websiteUrl: org.websiteUrl || "",
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const set = (key, val) => { setForm((f) => ({ ...f, [key]: val })); setDirty(true); setStatus(null); };

  const initial = { name: org.name || "", industry: org.industry || "", region: org.region || "", timezone: org.timezone || "", websiteUrl: org.websiteUrl || "" };

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateOrgSettings(org.slug, { orgInfo: form });
      onSaved(updated);
      setDirty(false);
      setStatus("saved");
      setTimeout(() => setStatus(null), 3000);
    } catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="settings-header">
        <h2 className="settings-header__title">Organization</h2>
        <p className="settings-header__desc">Manage your organization's basic information and settings</p>
      </div>
      <Card title="Company Details">
        <Field label={<>Company Name <span className="settings-required">*</span></>}>
          <input className="settings-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={<>Timezone <span className="settings-required">*</span></>}>
          <select className="settings-select" value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
            {["America/Los_Angeles","America/Denver","America/Chicago","America/New_York"].map((tz) => (
              <option key={tz} value={tz}>{tz.replace("America/", "")}</option>
            ))}
          </select>
        </Field>
        <Field label="Website URL">
          <input className="settings-input" type="url" value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} />
        </Field>
      </Card>
      <Card title="Industry Info">
        <Field label="Industry" hint="Primary industry category (e.g. HVAC, insulation, roofing).">
          <input className="settings-input" value={form.industry} onChange={(e) => set("industry", e.target.value)} />
        </Field>
        <Field label="Region" hint="Geographic market (e.g. Southern California, Greater Austin TX).">
          <input className="settings-input" value={form.region} onChange={(e) => set("region", e.target.value)} />
        </Field>
      </Card>
      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setForm(initial); setDirty(false); setStatus(null); }} />
    </>
  );
}

// ── Branch Config Panel ───────────────────────────────────────────────────────

const BRANCH_CONFIG_FIELDS = [
  { key: "baseHourlyRate", label: "Base Hourly Rate", hint: "Fully-loaded labor rate per tech-hour ($)", type: "number", step: "0.01" },
  { key: "wasteFactor", label: "Waste Factor", hint: "Material waste multiplier (e.g. 1.08 = 8% waste)", type: "number", step: "0.01" },
  { key: "minRetailPrice", label: "Min Retail Price", hint: "Minimum job charge before discounts ($)", type: "number", step: "1" },
  { key: "maxDiscount", label: "Max Discount (%)", hint: "Max % a salesperson can discount", type: "number", step: "0.1" },
  { key: "depositPercent", label: "Deposit (%)", hint: "% deposit required to book a job", type: "number", step: "0.1" },
  { key: "maxDepositAmount", label: "Max Deposit ($)", hint: "Dollar cap on the deposit amount", type: "number", step: "1" },
  { key: "creditCardFee", label: "Credit Card Fee", hint: "Processor rate (e.g. 0.03 = 3%)", type: "number", step: "0.001" },
  { key: "gasCost", label: "Gas Cost ($/gal)", hint: "Local pump price per gallon", type: "number", step: "0.01" },
  { key: "truckAverageMPG", label: "Truck Avg MPG", hint: "MPG for service vehicle fleet", type: "number", step: "0.5" },
  { key: "laborHoursLoadUnload", label: "Load/Unload Hours", hint: "Labor hours for loading and unloading per job", type: "number", step: "0.25" },
  { key: "subMultiplier", label: "Sub Multiplier", hint: "Cost multiplier applied to subcontracted work", type: "number", step: "0.01" },
  { key: "cashFactor", label: "Cash Factor", hint: "Discount factor for cash payments (e.g. 0.97)", type: "number", step: "0.001" },
  { key: "b2bMaxDiscount", label: "B2B Max Discount (%)", hint: "Max % discount for business customers", type: "number", step: "0.1" },
  { key: "bonusPoolPercentage", label: "Bonus Pool (%)", hint: "% of revenue allocated to crew bonus pool", type: "number", step: "0.1" },
  { key: "bonusPayoutCutoff", label: "Bonus Payout Cutoff", hint: "Performance score cutoff for bonus eligibility", type: "number", step: "1" },
];

function BranchConfigPanel({ org, onSaved }) {
  const branch0 = org.branches?.[0] || {};
  const initialForm = Object.fromEntries(BRANCH_CONFIG_FIELDS.map(({ key }) => [key, branch0[key] ?? ""]));
  const [form, setForm] = useState(initialForm);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const set = (key, val) => { setForm((f) => ({ ...f, [key]: val })); setDirty(true); setStatus(null); };

  async function handleSave() {
    setSaving(true);
    try {
      const branchConfig = Object.fromEntries(BRANCH_CONFIG_FIELDS.map(({ key }) => [key, parseFloat(form[key]) || 0]));
      const updated = await updateOrgSettings(org.slug, { branchConfig });
      onSaved(updated);
      setDirty(false);
      setStatus("saved");
      setTimeout(() => setStatus(null), 3000);
    } catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  const half = Math.ceil(BRANCH_CONFIG_FIELDS.length / 2);

  return (
    <>
      <div className="settings-header">
        <h2 className="settings-header__title">Branch Configuration</h2>
        <p className="settings-header__desc">
          Financial and operational parameters applied to all branches.
          {org.branches?.length > 1 && ` Changes apply to all ${org.branches.length} branches.`}
        </p>
      </div>
      <Card title="Labor & Materials">
        <div className="settings-two-col">
          <div>{BRANCH_CONFIG_FIELDS.slice(0, half).map(({ key, label, hint, type, step }) => (
            <Field key={key} label={label} hint={hint}>
              <input className="settings-input" type={type} step={step} value={form[key]} onChange={(e) => set(key, e.target.value)} />
            </Field>
          ))}</div>
          <div>{BRANCH_CONFIG_FIELDS.slice(half).map(({ key, label, hint, type, step }) => (
            <Field key={key} label={label} hint={hint}>
              <input className="settings-input" type={type} step={step} value={form[key]} onChange={(e) => set(key, e.target.value)} />
            </Field>
          ))}</div>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setForm(initialForm); setDirty(false); setStatus(null); }} />
    </>
  );
}

// ── Financing Terms Panel ─────────────────────────────────────────────────────

function FinancingTermsPanel({ org, onSaved }) {
  const initial = org.branches?.[0]?.branchFinancingTerms || [];
  const [terms, setTerms] = useState(initial.map((t) => ({ ...t })));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [newTerm, setNewTerm] = useState({ name: "", termMonths: 12, interestRate: 0, mostPopular: false });

  const mark = (ts) => { setTerms(ts); setDirty(true); setStatus(null); };

  const update = (idx, field, val) => {
    const ts = [...terms];
    ts[idx] = { ...ts[idx], [field]: val };
    mark(ts);
  };

  const add = () => {
    if (!newTerm.name.trim()) return;
    mark([...terms, { ...newTerm, termMonths: parseInt(newTerm.termMonths) || 12, interestRate: parseFloat(newTerm.interestRate) || 0 }]);
    setNewTerm({ name: "", termMonths: 12, interestRate: 0, mostPopular: false });
  };

  async function handleSave() {
    setSaving(true);
    try {
      const coerced = terms.map((t) => ({ ...t, termMonths: parseInt(t.termMonths) || 12, interestRate: parseFloat(t.interestRate) || 0 }));
      const updated = await updateOrgSettings(org.slug, { financingTerms: coerced });
      onSaved(updated);
      setDirty(false);
      setStatus("saved");
      setTimeout(() => setStatus(null), 3000);
    } catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="settings-header">
        <h2 className="settings-header__title">Financing Terms</h2>
        <p className="settings-header__desc">Financing options offered to customers. Applied to all branches.</p>
      </div>
      <Card title={`Financing Terms (${terms.length})`}>
        <div className="factors-table">
          <div className="factors-table__head" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 36px" }}>
            <span>Name</span><span>Months</span><span>Interest %</span><span>Most Popular</span><span></span>
          </div>
          {terms.map((t, idx) => (
            <div key={idx} className="factors-table__row" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 36px" }}>
              <input className="settings-input settings-input--sm" value={t.name} onChange={(e) => update(idx, "name", e.target.value)} placeholder="e.g. 0% for 12 Months" />
              <input className="settings-input settings-input--sm" type="number" value={t.termMonths} onChange={(e) => update(idx, "termMonths", e.target.value)} />
              <input className="settings-input settings-input--sm" type="number" step="0.01" value={t.interestRate} onChange={(e) => update(idx, "interestRate", e.target.value)} />
              <label className="pb-checkbox-label">
                <input type="checkbox" checked={!!t.mostPopular} onChange={(e) => update(idx, "mostPopular", e.target.checked)} />
                Popular
              </label>
              <button className="pb-btn-icon pb-btn-icon--danger" onClick={() => mark(terms.filter((_, i) => i !== idx))}>✕</button>
            </div>
          ))}
          <div className="factors-table__row factors-table__row--new" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 36px" }}>
            <input className="settings-input settings-input--sm" placeholder="e.g. Same as Cash 6 Months" value={newTerm.name} onChange={(e) => setNewTerm({ ...newTerm, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
            <input className="settings-input settings-input--sm" type="number" value={newTerm.termMonths} onChange={(e) => setNewTerm({ ...newTerm, termMonths: e.target.value })} />
            <input className="settings-input settings-input--sm" type="number" step="0.01" value={newTerm.interestRate} onChange={(e) => setNewTerm({ ...newTerm, interestRate: e.target.value })} />
            <label className="pb-checkbox-label"><input type="checkbox" checked={newTerm.mostPopular} onChange={(e) => setNewTerm({ ...newTerm, mostPopular: e.target.checked })} />Popular</label>
            <button className="btn btn--secondary" style={{ whiteSpace: "nowrap", fontSize: 12 }} onClick={add}>+ Add</button>
          </div>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setTerms(initial.map((t) => ({ ...t }))); setDirty(false); setStatus(null); }} />
    </>
  );
}

// ── Proposal Content Panel ────────────────────────────────────────────────────

// Customer-facing proposal placeholders. The Menaia proposal system only
// interpolates these exact tokens (note the spaces inside the braces).
const PROPOSAL_PLACEHOLDER_HINT = "Placeholders: {{ company_name }}, {{ client_first_name }}, {{ inspector_name }}, {{ inspector_number }}, {{ date }}";

const COMPANY_FIELDS = [
  { key: "about", label: "About / Welcome", hint: "Intro block at the top of every proposal — who you are and what to expect.", rows: 6 },
  { key: "aboutVideoUrl", label: "About Video URL", hint: "Optional — a YouTube/Vimeo link shown with the About section.", rows: 1 },
  { key: "contractorLicense", label: "Contractor License", hint: "License number shown on the proposal (e.g. CA Lic. #1036543).", rows: 1 },
];

const PROPOSAL_FIELDS = [
  { key: "disclaimer", label: "Disclaimer", hint: "Shown on every proposal — estimates, site conditions.", rows: 3 },
  { key: "paymentTerms", label: "Payment Terms", hint: "Deposit, progress payments, and balance due policy.", rows: 4 },
  { key: "insuranceClaims", label: "Insurance Claims", hint: "Customer's responsibility for insurance work.", rows: 4 },
  { key: "termsAndConditions", label: "Terms & Conditions", hint: "Authorization, warranty, change orders, governing law, cancellation.", rows: 8 },
  { key: "defaultProposalEmailSubject", label: "Proposal Email Subject", hint: PROPOSAL_PLACEHOLDER_HINT, rows: 1 },
  { key: "defaultProposalEmailBody", label: "Proposal Email Body", hint: PROPOSAL_PLACEHOLDER_HINT, rows: 8 },
];

const ALL_PROPOSAL_FIELDS = [...COMPANY_FIELDS, ...PROPOSAL_FIELDS];

function ProposalContentPanel({ org, onSaved }) {
  const buildInitial = () => {
    const branch0 = org.branches?.[0] || {};
    return Object.fromEntries(ALL_PROPOSAL_FIELDS.map(({ key }) => [key, branch0[key] || ""]));
  };
  const [form, setForm] = useState(buildInitial);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [generating, setGenerating] = useState(false);

  const set = (key, val) => { setForm((f) => ({ ...f, [key]: val })); setDirty(true); setStatus(null); };

  const renderField = ({ key, label, hint, rows }) => (
    <Field key={key} label={label} hint={hint}>
      {rows > 1
        ? <textarea className="settings-textarea" rows={rows} value={form[key]} onChange={(e) => set(key, e.target.value)} disabled={generating} />
        : <input className="settings-input" value={form[key]} onChange={(e) => set(key, e.target.value)} disabled={generating} />}
    </Field>
  );

  async function handleGenerate() {
    setGenerating(true);
    setStatus(null);
    try {
      const updated = await generateProposalContent(org.slug);
      const branch0 = updated.branches?.[0] || {};
      // About/Video/License live on the branch but aren't regenerated by the AI
      // call — keep the existing edits, overlay the freshly generated copy.
      setForm((f) => ({
        ...f,
        ...Object.fromEntries(ALL_PROPOSAL_FIELDS.map(({ key }) => [key, branch0[key] ?? f[key] ?? ""])),
      }));
      onSaved(updated);
      setDirty(true);
    } catch { setStatus("error"); }
    finally { setGenerating(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateOrgSettings(org.slug, { proposalContent: form });
      onSaved(updated);
      setDirty(false);
      setStatus("saved");
      setTimeout(() => setStatus(null), 3000);
    } catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="settings-header">
        <h2 className="settings-header__title">Proposal Content</h2>
        <p className="settings-header__desc">Text shown on customer proposals and emails. Applied to all branches.</p>
      </div>
      <Card title="Company / About" description="Shown at the top of every proposal.">
        <div className="img-style-suggest-row">
          <div className="img-style-suggest-info">
            <span className="img-style-suggest-info__icon">✨</span>
            <span>Generate polished proposal copy (About, terms & email) from your industry and region</span>
          </div>
          <button className="btn btn--secondary" onClick={handleGenerate} disabled={generating || saving}>
            {generating ? "Generating…" : "Generate with AI"}
          </button>
        </div>
        {COMPANY_FIELDS.map(renderField)}
      </Card>
      <Card title="Legal & Terms">
        {PROPOSAL_FIELDS.slice(0, 4).map(renderField)}
      </Card>
      <Card title="Proposal Email Template">
        {PROPOSAL_FIELDS.slice(4).map(renderField)}
      </Card>
      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setForm(buildInitial()); setDirty(false); setStatus(null); }} />
    </>
  );
}

// ── Image Style Panel ─────────────────────────────────────────────────────────

function ImageStylePanel({ org, onSaved }) {
  const initial = org.imageStyle || { home: "", technician: "", styleNotes: "" };
  const [form, setForm] = useState({ ...initial });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [suggesting, setSuggesting] = useState(false);

  const set = (key, val) => { setForm((f) => ({ ...f, [key]: val })); setDirty(true); setStatus(null); };

  async function handleSuggest() {
    setSuggesting(true);
    setStatus(null);
    try {
      const suggestion = await suggestImageStyle(org.slug);
      setForm({
        home: suggestion.home || form.home,
        technician: suggestion.technician || form.technician,
        styleNotes: suggestion.styleNotes || form.styleNotes,
      });
      setDirty(true);
    } catch (err) {
      setStatus("error");
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateOrgSettings(org.slug, { imageStyle: form });
      onSaved(updated);
      setDirty(false);
      setStatus("saved");
      setTimeout(() => setStatus(null), 3000);
    } catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  const hasStyle = form.home || form.technician || form.styleNotes;

  return (
    <>
      <div className="settings-header">
        <h2 className="settings-header__title">Image Style</h2>
        <p className="settings-header__desc">
          Define a consistent visual identity for all AI-generated item images.
          The same home and technician will appear in every image — creating a coherent look across your entire catalog.
        </p>
      </div>

      <Card
        title="Visual Continuity Settings"
        description="These descriptions are injected into every AI image prompt. Use specific, vivid language — the more detail, the more consistent the results."
      >
        <div className="img-style-suggest-row">
          <div className="img-style-suggest-info">
            <span className="img-style-suggest-info__icon">✨</span>
            <span>Let AI suggest defaults based on your industry and region</span>
          </div>
          <button
            className="btn btn--secondary"
            onClick={handleSuggest}
            disabled={suggesting || saving}
          >
            {suggesting ? "Generating…" : "AI Suggest"}
          </button>
        </div>

        <Field
          label="Hero Home"
          hint="The property that appears in all outdoor and equipment images. Be specific: architectural style, materials, era, surroundings, region."
        >
          <textarea
            className="settings-textarea"
            rows={4}
            placeholder={`e.g. "1985 single-story ranch house with beige stucco exterior and Spanish clay tile roof, attached 2-car garage, manicured green lawn, concrete driveway, palm trees, suburban Southern California neighborhood"`}
            value={form.home}
            onChange={(e) => set("home", e.target.value)}
            disabled={suggesting}
          />
        </Field>

        <Field
          label="Technician"
          hint="The person who appears in service images. Describe uniform, gear, and general appearance — avoid describing a specific face."
        >
          <textarea
            className="settings-textarea"
            rows={3}
            placeholder={`e.g. "Technician in navy blue uniform with orange shoulder stripes and company logo patch, black work boots, safety glasses, mid-30s, medium build"`}
            value={form.technician}
            onChange={(e) => set("technician", e.target.value)}
            disabled={suggesting}
          />
        </Field>

        <Field
          label="Style Notes"
          hint="Optional: lighting, mood, color temperature, time of day."
        >
          <input
            className="settings-input"
            placeholder={`e.g. "Bright midday sunlight, warm tones, clean and organized job site"`}
            value={form.styleNotes}
            onChange={(e) => set("styleNotes", e.target.value)}
            disabled={suggesting}
          />
        </Field>

        {hasStyle && (
          <div className="img-style-preview">
            <div className="img-style-preview__label">Preview — what the AI will see:</div>
            <div className="img-style-preview__block">
              {form.home && (
                <div className="img-style-preview__row">
                  <span className="img-style-preview__key">🏠 Home</span>
                  <span>{form.home}</span>
                </div>
              )}
              {form.technician && (
                <div className="img-style-preview__row">
                  <span className="img-style-preview__key">👷 Tech</span>
                  <span>{form.technician}</span>
                </div>
              )}
              {form.styleNotes && (
                <div className="img-style-preview__row">
                  <span className="img-style-preview__key">🎨 Style</span>
                  <span>{form.styleNotes}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <SaveBar
        dirty={dirty}
        saving={saving}
        status={status}
        onSave={handleSave}
        onDiscard={() => { setForm(initial); setDirty(false); setStatus(null); }}
      />
    </>
  );
}

// ── Logo Panel ────────────────────────────────────────────────────────────────

const LOGO_VARIANTS = [
  { id: "white",   label: "White",   bg: "#1f2937", hint: "For dark backgrounds" },
  { id: "dark",    label: "Dark",    bg: "#f9fafb", hint: "For light backgrounds" },
  { id: "color",   label: "Color",   bg: "#e5e7eb", hint: "For neutral backgrounds" },
  { id: "default", label: "Default", bg: "#f3f4f6", hint: "Fallback variant" },
];

const LOGO_CORNERS = [
  { id: "top-left",     label: "↖" },
  { id: "top-right",    label: "↗" },
  { id: "bottom-left",  label: "↙" },
  { id: "bottom-right", label: "↘" },
];

const DEFAULT_LOGO_OVERLAY = {
  position: "bottom-left",
  backdrop: { enabled: false, shape: "ellipse", color: "auto", opacity: 0.4 },
};

function LogoPanel({ org }) {
  const { slug } = org;
  const [variants, setVariants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [imgBust, setImgBust] = useState(Date.now());
  const [sources, setSources] = useState([]);
  const [importFrom, setImportFrom] = useState("");
  const [importing, setImporting] = useState(false);
  const [overlay, setOverlay] = useState(() => ({
    ...DEFAULT_LOGO_OVERLAY,
    ...(org.logoOverlay || {}),
    backdrop: { ...DEFAULT_LOGO_OVERLAY.backdrop, ...(org.logoOverlay?.backdrop || {}) },
  }));
  const [savingOverlay, setSavingOverlay] = useState(false);
  const [overlaySaved, setOverlaySaved] = useState(false);
  const fileRefs = useRef({});

  const setBackdrop = (patch) =>
    setOverlay((o) => ({ ...o, backdrop: { ...o.backdrop, ...patch } }));

  useEffect(() => {
    listOrgLogos(slug)
      .then(setVariants)
      .catch(() => setVariants([]))
      .finally(() => setLoading(false));
    listLogoSources(slug)
      .then(setSources)
      .catch(() => setSources([]));
  }, [slug]);

  async function handleImport() {
    if (!importFrom) return;
    setImporting(true);
    setError(null);
    try {
      const data = await importOrgLogo(slug, importFrom);
      setVariants(data.variants);
      setImgBust(Date.now());
      setImportFrom("");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  const itemsWithImages = (org.resources?.categories || [])
    .flatMap((c) => c.items || [])
    .filter((i) => i.imageUrl).length;

  async function handleUpload(variantId, file) {
    if (!file) return;
    setError(null);
    try {
      await uploadOrgLogo(slug, variantId, file);
      const updated = await listOrgLogos(slug);
      setVariants(updated);
      setImgBust(Date.now());
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(variantId) {
    setError(null);
    try {
      await deleteOrgLogo(slug, variantId);
      const updated = await listOrgLogos(slug);
      setVariants(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveOverlay() {
    setSavingOverlay(true);
    setError(null);
    try {
      await updateOrgSettings(slug, { logoOverlay: overlay });
      setOverlaySaved(true);
      setTimeout(() => setOverlaySaved(false), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingOverlay(false);
    }
  }

  async function handleBulkApply() {
    setApplying(true);
    setResult(null);
    setError(null);
    try {
      // Persist the current overlay config, then stamp every image with it.
      await updateOrgSettings(slug, { logoOverlay: overlay });
      const data = await bulkApplyOrgLogo(slug, overlay);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <div className="settings-header">
        <h2 className="settings-header__title">Logo</h2>
        <p className="settings-header__desc">
          Upload logo variants and apply them to all item images. Originals are kept — a separate logo copy is saved alongside each image.
        </p>
      </div>

      <Card title="Logo Variants" description="Upload different versions. The best one is auto-selected per image based on background brightness.">
        {loading ? (
          <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af" }}>Loading…</div>
        ) : (
          <div className="org-logo-variants">
            {LOGO_VARIANTS.map((v) => {
              const hasLogo = variants.includes(v.id);
              return (
                <div key={v.id} className="org-logo-variant">
                  <div className="org-logo-variant__preview" style={{ background: v.bg }}>
                    {hasLogo ? (
                      <img
                        src={`/api/orgs/${slug}/logo/${v.id}?t=${imgBust}`}
                        alt={v.label}
                        className="org-logo-variant__img"
                      />
                    ) : (
                      <div className="org-logo-variant__empty">+</div>
                    )}
                  </div>
                  <div className="org-logo-variant__label">{v.label}</div>
                  <div className="org-logo-variant__hint">{v.hint}</div>
                  <div className="org-logo-variant__actions">
                    <button
                      className="btn btn--secondary"
                      style={{ fontSize: 11, padding: "3px 10px" }}
                      onClick={() => fileRefs.current[v.id]?.click()}
                    >
                      {hasLogo ? "Replace" : "+ Upload"}
                    </button>
                    {hasLogo && (
                      <button
                        className="btn btn--danger-outline"
                        style={{ fontSize: 11, padding: "3px 8px" }}
                        onClick={() => handleDelete(v.id)}
                      >
                        ✕
                      </button>
                    )}
                    <input
                      ref={(el) => { fileRefs.current[v.id] = el; }}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => { handleUpload(v.id, e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {sources.length > 0 && (
          <div className="org-logo-import">
            <div className="org-logo-import__label">Or use a demo logo</div>
            <div className="org-logo-import__row">
              <select
                className="settings-input org-logo-import__select"
                value={importFrom}
                onChange={(e) => setImportFrom(e.target.value)}
                disabled={importing}
              >
                <option value="">Select a demo…</option>
                {sources.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}{s.industry ? ` · ${s.industry}` : ""} ({s.variants.join(", ")})
                  </option>
                ))}
              </select>
              <button
                className="btn btn--secondary"
                onClick={handleImport}
                disabled={!importFrom || importing}
              >
                {importing ? "Importing…" : "Use this logo"}
              </button>
            </div>
            <div className="org-logo-import__hint">Copies the demo's logo variants into this org. Replaces any matching variants.</div>
          </div>
        )}
        {error && <div className="org-logo-error">{error}</div>}
      </Card>

      <Card
        title="Logo Placement & Backdrop"
        description="Choose the corner and an optional translucent oval/plate behind the logo so it stays legible over light or busy photos. Applies to the catalog stamp and the deploy."
      >
        <div className="logo-overlay-config">
          <label className="logo-overlay-config__toggle">
            <input
              type="checkbox"
              checked={overlay.position === "auto"}
              onChange={(e) => setOverlay((o) => ({ ...o, position: e.target.checked ? "auto" : "bottom-left" }))}
            />
            <span>Auto-detect the best corner per image</span>
          </label>

          <div className="logo-overlay-config__field">
            <span className="logo-overlay-config__label">
              {overlay.position === "auto" ? "Corner (chosen per image)" : "Corner"}
            </span>
            <div className={`logo-corner-grid ${overlay.position === "auto" ? "logo-corner-grid--disabled" : ""}`}>
              {LOGO_CORNERS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={overlay.position === "auto"}
                  className={`logo-corner-grid__cell ${overlay.position === c.id ? "logo-corner-grid__cell--active" : ""}`}
                  onClick={() => setOverlay((o) => ({ ...o, position: c.id }))}
                  title={c.id.replace("-", " ")}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {overlay.position === "auto" && (
              <span className="logo-overlay-config__hint">
                Each image gets the calmest, least-busy corner automatically.
              </span>
            )}
          </div>

          <label className="logo-overlay-config__toggle">
            <input
              type="checkbox"
              checked={overlay.backdrop.enabled}
              onChange={(e) => setBackdrop({ enabled: e.target.checked })}
            />
            <span>Add a backdrop behind the logo</span>
          </label>

          {overlay.backdrop.enabled && (
            <div className="logo-overlay-config__grid">
              <div className="logo-overlay-config__field">
                <span className="logo-overlay-config__label">Shape</span>
                <select
                  className="settings-input"
                  value={overlay.backdrop.shape}
                  onChange={(e) => setBackdrop({ shape: e.target.value })}
                >
                  <option value="ellipse">Oval</option>
                  <option value="rounded">Rounded plate</option>
                </select>
              </div>

              <div className="logo-overlay-config__field">
                <span className="logo-overlay-config__label">Color</span>
                <select
                  className="settings-input"
                  value={overlay.backdrop.color}
                  onChange={(e) => setBackdrop({ color: e.target.value })}
                >
                  <option value="auto">Auto (contrast with photo)</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>

              <div className="logo-overlay-config__field">
                <span className="logo-overlay-config__label">
                  Opacity · {Math.round(overlay.backdrop.opacity * 100)}%
                </span>
                <input
                  type="range"
                  min="5"
                  max="90"
                  step="5"
                  value={Math.round(overlay.backdrop.opacity * 100)}
                  onChange={(e) => setBackdrop({ opacity: Number(e.target.value) / 100 })}
                />
              </div>
            </div>
          )}

          <div className="logo-overlay-config__actions">
            <button className="btn btn--secondary" onClick={handleSaveOverlay} disabled={savingOverlay}>
              {savingOverlay ? "Saving…" : overlaySaved ? "Saved ✓" : "Save placement"}
            </button>
            <span className="logo-overlay-config__hint">
              Saved automatically when you apply to the catalog.
            </span>
          </div>
        </div>
      </Card>

      <Card
        title="Apply to Catalog"
        description="Stamp the logo onto every item image in this org. The originals stay untouched — a new copy with the overlay is saved as a separate file."
      >
        <div className="org-logo-apply-row">
          <div className="org-logo-apply-info">
            <div className="org-logo-apply-info__count">
              {itemsWithImages} item image{itemsWithImages !== 1 ? "s" : ""} found
            </div>
            <div className="org-logo-apply-info__hint">
              {variants.length === 0
                ? "Upload at least one logo variant first"
                : `${variants.join(", ")} variant${variants.length > 1 ? "s" : ""} available — best selected per image brightness`}
            </div>
          </div>
          <button
            className="btn btn--primary"
            onClick={handleBulkApply}
            disabled={applying || variants.length === 0 || itemsWithImages === 0}
          >
            {applying ? "Applying…" : "Apply Logo to All Images"}
          </button>
        </div>

        {result && (
          <div className={`org-logo-result ${result.failed?.length ? "org-logo-result--warn" : "org-logo-result--ok"}`}>
            {result.succeeded} image{result.succeeded !== 1 ? "s" : ""} updated
            {result.failed?.length > 0 && ` · ${result.failed.length} failed`}
          </div>
        )}
      </Card>
    </>
  );
}

// ── Item Image Panel ──────────────────────────────────────────────────────────

function ItemImagePanel({ slug, categoryName, item, onImageChange }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [imgUrl, setImgUrl] = useState(item.imageUrl || null);

  const bust = (url) => url ? `${url}?t=${Date.now()}` : null;

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadItemImage(slug, categoryName, item.name, file);
      setImgUrl(res.imageUrl);
      onImageChange(res.imageUrl);
    } catch (err) { setError(err.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateItemImage(slug, categoryName, item.name, item.itemInfo);
      setImgUrl(res.imageUrl);
      onImageChange(res.imageUrl);
    } catch (err) { setError(err.message); }
    finally { setGenerating(false); }
  }

  async function handleDelete() {
    if (!confirm("Remove this image?")) return;
    setError(null);
    try {
      await deleteItemImage(slug, categoryName, item.name);
      setImgUrl(null);
      onImageChange(null);
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="item-image-panel">
      <div className="item-image-panel__label">Item Media</div>
      <div className="item-image-panel__preview" onClick={() => !imgUrl && fileRef.current?.click()}>
        {imgUrl ? (
          <img src={bust(imgUrl)} alt={item.name} className="item-image-panel__img" />
        ) : (
          <div className="item-image-panel__empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M6.75 21h10.5A2.25 2.25 0 0019.5 18.75V6.75A2.25 2.25 0 0017.25 4.5H6.75A2.25 2.25 0 004.5 6.75v12A2.25 2.25 0 006.75 21z" />
            </svg>
            <p>Click or drag to upload</p>
            <span>Images (max 20MB)</span>
          </div>
        )}
      </div>

      {error && <div className="item-image-panel__error">{error}</div>}

      <div className="item-image-panel__actions">
        <button className="btn btn--secondary" onClick={() => fileRef.current?.click()} disabled={uploading || generating}>
          {uploading ? "Uploading…" : "+ Upload New"}
        </button>
        <button className="btn btn--ai" onClick={handleGenerate} disabled={uploading || generating}>
          {generating ? "Generating…" : "✨ Generate AI"}
        </button>
        {imgUrl && (
          <button className="btn btn--danger-outline" onClick={handleDelete} disabled={uploading || generating}>Delete</button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleUpload} />
    </div>
  );
}

// ── Bulk Generate Modal ───────────────────────────────────────────────────────

// All AI generation models across providers
// provider: openai | replicate | gemini
const AI_MODELS = [
  // OpenAI
  { id: "openai-draft", provider: "openai",     model: "gpt-image-1",                      quality: "low",    label: "Draft",          group: "OpenAI",        cost: 0.006,  badge: "Fast, low quality"    },
  { id: "openai-good",  provider: "openai",     model: "gpt-image-1",                      quality: "medium", label: "Good",           group: "OpenAI",        cost: 0.017,  badge: "Balanced quality"     },
  { id: "openai-best",  provider: "openai",     model: "gpt-image-1",                      quality: "high",   label: "Best",           group: "OpenAI",        cost: 0.25,   badge: "Highest quality"      },
  // Flux (Replicate)
  { id: "flux-pro",     provider: "replicate",  model: "black-forest-labs/flux-1.1-pro",   quality: null,     label: "Flux Pro",       group: "Replicate",     cost: 0.04,   badge: "Great photorealism"   },
  { id: "flux-ultra",   provider: "replicate",  model: "black-forest-labs/flux-1.1-pro-ultra", quality: null, label: "Flux Ultra",     group: "Replicate",     cost: 0.06,   badge: "Best Flux quality"    },
  // Nano Banana 2 (Gemini)
  { id: "nb2-1k",       provider: "gemini",     model: "gemini-3.1-flash-image-preview",   quality: "1k",     label: "Nano Banana 2",  group: "Google",        cost: 0.067,  badge: "Subject consistency"  },
  { id: "nb2-4k",       provider: "gemini",     model: "gemini-3.1-flash-image-preview",   quality: "4k",     label: "Nano Banana 4K", group: "Google",        cost: 0.151,  badge: "4K resolution"        },
];

// Queue modes — web + all AI models
const QUEUE_MODES = [
  { id: "web", label: "🌐 Web", sub: "Free", mode: "web", provider: null, model: null, quality: null },
  ...AI_MODELS.map((m) => ({
    id:       m.id,
    label:    `✨ ${m.label}`,
    sub:      `$${m.cost}/img`,
    mode:     "generate",
    provider: m.provider,
    model:    m.model,
    quality:  m.quality,
  })),
];

// ── Queue Panel — floating bottom-right, shows generation progress ─────────────

function QueuePanel({ queue, running, onStop, onClear, onClose }) {
  const [collapsed, setCollapsed] = useState(false);
  const done   = queue.filter((i) => i.status === "done").length;
  const total  = queue.length;
  const errors = queue.filter((i) => i.status === "error").length;
  const pct    = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className={`queue-panel ${collapsed ? "queue-panel--collapsed" : ""}`}>
      {/* Header */}
      <div className="queue-panel__header" onClick={() => setCollapsed((v) => !v)}>
        <div className="queue-panel__title">
          {running
            ? <span className="queue-panel__spin">⟳</span>
            : done === total ? <span style={{ color: "#16a34a" }}>✓</span> : "·"
          }
          <span>Image Queue</span>
          <span className="queue-panel__badge">{done}/{total}</span>
        </div>
        <div className="queue-panel__header-btns" onClick={(e) => e.stopPropagation()}>
          {running
            ? <button className="queue-panel__btn" onClick={onStop} title="Stop after current item">⏹</button>
            : <button className="queue-panel__btn" onClick={onClear} title="Clear queue">Clear</button>
          }
          <button className="queue-panel__btn" onClick={onClose} title="Hide">✕</button>
          <span className="queue-panel__chevron">{collapsed ? "▴" : "▾"}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="queue-panel__prog">
        <div className="queue-panel__prog-fill" style={{ width: `${pct}%` }} />
      </div>

      {/* Item list */}
      {!collapsed && (
        <div className="queue-panel__list">
          {queue.map((item) => (
            <div key={item.id} className={`queue-item queue-item--${item.status}`}>
              <span className="queue-item__icon">
                {item.status === "done"    ? "✓"
                : item.status === "error"  ? "✗"
                : item.status === "running" ? <span className="queue-panel__spin">⟳</span>
                : "·"}
              </span>
              <div className="queue-item__info">
                <span className="queue-item__name">{item.itemName}</span>
                <span className="queue-item__cat">{item.categoryName}</span>
                {item.status === "error" && (
                  <span className="queue-item__err">{item.error}</span>
                )}
              </div>
              <div className="queue-item__thumb">
                {item.imageUrl
                  ? <img src={`${item.imageUrl}?t=${item.ts || 0}`} alt="" />
                  : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {!running && !collapsed && errors > 0 && (
        <div className="queue-panel__footer">{errors} failed</div>
      )}
    </div>
  );
}

// ── Selection Toolbar — appears when items are selected ───────────────────────

function SelectionToolbar({ count, running, onAddToQueue, onClearSelection }) {
  const [mode, setMode] = useState("web");
  const [comment, setComment] = useState("");
  const selectedMode = QUEUE_MODES.find((m) => m.id === mode);
  const isGenerate = selectedMode?.mode === "generate";

  return (
    <div className="selection-toolbar">
      <div className="selection-toolbar__row">
        <span className="selection-toolbar__count">
          {count} item{count !== 1 ? "s" : ""} selected
        </span>
        <div className="selection-toolbar__modes">
          {QUEUE_MODES.map((m) => (
            <button
              key={m.id}
              className={`sel-mode-btn ${mode === m.id ? "sel-mode-btn--active" : ""}`}
              onClick={() => setMode(m.id)}
              title={m.sub}
            >
              {m.label}
              <span className="sel-mode-btn__sub">{m.sub}</span>
            </button>
          ))}
        </div>
        <button
          className="btn btn--primary btn--sm"
          onClick={() => onAddToQueue({ ...selectedMode, comment: isGenerate ? comment.trim() : "" })}
          disabled={running}
          title={running ? "Queue is running — wait or stop it first" : ""}
        >
          {running ? "Queue running…" : "Add to Queue →"}
        </button>
        <button className="btn btn--secondary btn--sm" onClick={onClearSelection}>
          Clear
        </button>
      </div>
      {isGenerate && (
        <textarea
          className="selection-toolbar__comment"
          rows={2}
          placeholder={`Avoid / negative prompt — applies to this queue. e.g. "no open windows in attics, no oversized crawl spaces"`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      )}
    </div>
  );
}

function BulkGenerateModal({ slug, cat, orgContext, onClose, onDone }) {
  const { industry, region } = orgContext || {};
  const [mode, setMode] = useState("web");
  const [aiModelId, setAiModelId] = useState("openai-draft");
  const [overwrite, setOverwrite] = useState(false);
  const [comment, setComment] = useState("");
  const [phase, setPhase] = useState("config"); // config | running | done

  // Live item state — tracks image + status per item
  const [itemStates, setItemStates] = useState(() =>
    cat.items.map((item) => ({ name: item.name, imageUrl: item.imageUrl || null, status: null }))
  );

  const existingCount = cat.items.filter((i) => i.imageUrl).length;
  const toProcess = overwrite ? cat.items.length : (cat.items.length - existingCount);
  const aiModel = AI_MODELS.find((m) => m.id === aiModelId);
  const estimatedCost = aiModel ? `~$${(aiModel.cost * toProcess).toFixed(2)}` : null;
  const modelGroups = AI_MODELS.reduce((acc, m) => { if (!acc[m.group]) acc[m.group] = []; acc[m.group].push(m); return acc; }, {});

  function patchItem(name, patch) {
    setItemStates((prev) => prev.map((s) => s.name === name ? { ...s, ...patch } : s));
  }

  async function start() {
    setPhase("running");
    // Mark items as pending
    setItemStates(cat.items.map((item) => ({
      name: item.name,
      imageUrl: item.imageUrl || null,
      status: item.imageUrl && !overwrite ? "skipped" : "pending",
    })));

    try {
      await bulkGenerateImages(slug, cat.name, {
        mode,
        provider: aiModel?.provider,
        model: aiModel?.model,
        quality: aiModel?.quality,
        overwrite,
        comment: mode === "generate" ? comment.trim() : "",
        onProgress: (data) => {
          patchItem(data.item, {
            status: data.status,
            imageUrl: data.imageUrl || undefined,
          });
        },
        onDone: (results) => {
          setPhase("done");
          onDone(results);
        },
      });
    } catch (err) {
      setPhase("config");
    }
  }

  const doneCount = itemStates.filter((s) => s.status === "done").length;
  const errorCount = itemStates.filter((s) => s.status === "error").length;

  const STATUS_ICON = { done: "✓", error: "✗", skipped: "–", pending: "·", searching: "…", generating: "…" };
  const STATUS_CLS  = { done: "bgi-item__status--done", error: "bgi-item__status--error", skipped: "bgi-item__status--skip" };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && phase !== "running" && onClose()}>
      <div className="modal-box modal-box--bgi">

        {/* Header */}
        <div className="modal-box__header">
          <div>
            <div className="bgi-header__eyebrow">Item Images</div>
            <h3 className="bgi-header__title">{cat.name}</h3>
          </div>
          {phase !== "running" && <button className="modal-box__close" onClick={onClose}>✕</button>}
        </div>

        {/* Config phase */}
        {phase === "config" && (
          <>
            {/* Mode selector */}
            <div className="bgi-modes">
              <button
                className={`bgi-mode ${mode === "web" ? "bgi-mode--active" : ""}`}
                onClick={() => setMode("web")}
              >
                <span className="bgi-mode__icon">🌐</span>
                <div>
                  <div className="bgi-mode__label">Web Search</div>
                  <div className="bgi-mode__sub">Free · Scores & picks best real photo</div>
                </div>
              </button>
              <button
                className={`bgi-mode ${mode === "generate" ? "bgi-mode--active" : ""}`}
                onClick={() => setMode("generate")}
              >
                <span className="bgi-mode__icon">✨</span>
                <div>
                  <div className="bgi-mode__label">AI Generate</div>
                  <div className="bgi-mode__sub">Paid · Creates original image per item</div>
                </div>
              </button>
            </div>

            {/* AI model selector — grouped by provider */}
            {mode === "generate" && (
              <div className="bgi-provider-groups">
                {Object.entries(modelGroups).map(([group, models]) => (
                  <div key={group} className="bgi-provider-group">
                    <div className="bgi-provider-group__label">{group}</div>
                    <div className="bgi-ai-models">
                      {models.map((m) => (
                        <button
                          key={m.id}
                          className={`bgi-ai-model ${aiModelId === m.id ? "bgi-ai-model--active" : ""}`}
                          onClick={() => setAiModelId(m.id)}
                        >
                          <span className="bgi-ai-model__label">{m.label}</span>
                          <span className="bgi-ai-model__badge">{m.badge}</span>
                          <span className="bgi-ai-model__cost">${m.cost}/img</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Negative-prompt comment — applies to this run only */}
            {mode === "generate" && (
              <div className="bgi-comment">
                <label className="bgi-comment__label">
                  Avoid / negative prompt <span className="bgi-comment__hint">applies to this run only</span>
                </label>
                <textarea
                  className="settings-textarea"
                  rows={2}
                  placeholder={`Call out unrealistic things you keep seeing, e.g. "no open windows in attics, no oversized crawl spaces, no glossy showroom floors"`}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            )}

            {/* Context chips */}
            {(industry || region) && (
              <div className="bgi-context">
                <span className="bgi-context__label">Context:</span>
                {industry && <span className="bgi-context__chip">{industry}</span>}
                {region   && <span className="bgi-context__chip">{region}</span>}
                <span className="bgi-context__chip">item names + descriptions</span>
              </div>
            )}

            {/* Overwrite toggle */}
            {existingCount > 0 && (
              <label className="pb-checkbox-label bgi-overwrite">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Replace {existingCount} existing image{existingCount !== 1 ? "s" : ""}
              </label>
            )}

            {/* Item preview list */}
            <div className="bgi-items">
              {cat.items.map((item) => {
                const willSkip = !!item.imageUrl && !overwrite;
                return (
                  <div key={item.name} className={`bgi-item ${willSkip ? "bgi-item--skip" : ""}`}>
                    <div className="bgi-item__thumb">
                      {item.imageUrl
                        ? <img src={item.imageUrl} alt="" />
                        : <span>–</span>}
                    </div>
                    <span className="bgi-item__name">{item.name}</span>
                    {willSkip && <span className="bgi-item__tag">exists</span>}
                  </div>
                );
              })}
            </div>

            {/* Action */}
            <div className="bgi-footer">
              {mode === "generate" && estimatedCost && (
                <span className="bgi-footer__cost">Est. {estimatedCost} for {toProcess} image{toProcess !== 1 ? "s" : ""}</span>
              )}
              <button
                className="btn btn--primary"
                onClick={start}
                disabled={toProcess === 0}
              >
                {toProcess === 0 ? "All images present" : `Generate ${toProcess} image${toProcess !== 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        )}

        {/* Running phase — live thumbnails */}
        {(phase === "running" || phase === "done") && (
          <>
            <div className="bgi-items">
              {itemStates.map((s) => (
                <div key={s.name} className={`bgi-item ${s.status === "skipped" ? "bgi-item--skip" : ""}`}>
                  <div className={`bgi-item__thumb ${s.status === "searching" || s.status === "generating" ? "bgi-item__thumb--loading" : ""}`}>
                    {s.imageUrl
                      ? <img src={s.imageUrl} alt="" />
                      : <span>–</span>}
                  </div>
                  <span className="bgi-item__name">{s.name}</span>
                  <span className={`bgi-item__status ${STATUS_CLS[s.status] || ""}`}>
                    {STATUS_ICON[s.status] || ""}
                  </span>
                </div>
              ))}
            </div>

            {phase === "done" && (
              <div className="bgi-footer bgi-footer--done">
                <span>
                  ✓ {doneCount} generated{errorCount > 0 ? ` · ${errorCount} failed` : ""}
                </span>
                <button className="btn btn--secondary" onClick={onClose}>Close</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Item Image Editor — shared by ItemRefineModal and ItemDetailEdit ──────────
// onDone: optional callback for "Done" button (pass onClose from the modal, or null when embedded)

function ItemImageEditor({ slug, item, categoryName, orgContext, onImageChange, onDone }) {
  const { industry, region } = orgContext || {};
  const hasExistingImage = !!item.imageUrl;

  const [tab, setTab] = useState(hasExistingImage ? "fix" : "replace");
  const [feedback, setFeedback] = useState("");
  const [contextHint, setContextHint] = useState("");
  const [aiModelId, setAiModelId] = useState("openai-draft");
  const [phase, setPhase] = useState("idle");
  const [candidates, setCandidates] = useState([]);
  const [displaySrc, setDisplaySrc] = useState(
    item.imageUrl ? `${item.imageUrl}?t=${item.imageUpdatedAt || 0}` : null
  );
  const [error, setError] = useState(null);

  const contextPills = [categoryName, industry, region].filter(Boolean);
  const busy = phase === "searching" || phase === "working";

  function applyNewImage(url) {
    setDisplaySrc(`${url}?t=${Date.now()}`);
    onImageChange(url);
    setPhase("done");
    setError(null);
    setFeedback("");
  }

  async function handleFix() {
    if (!feedback.trim()) return;
    setPhase("working");
    setError(null);
    try {
      const res = await editItemImage(slug, categoryName, item.name, feedback.trim());
      applyNewImage(res.imageUrl);
    } catch (err) {
      setError(err.message);
      setPhase("idle");
    }
  }

  async function handleWebSearch() {
    setPhase("searching");
    setError(null);
    setCandidates([]);
    try {
      const results = await fetchItemCandidates(slug, categoryName, item.name, {
        count: 3,
        contextHint: contextHint.trim(),
      });
      setCandidates(results);
      setPhase("idle");
    } catch (err) {
      setError(err.message);
      setPhase("idle");
    }
  }

  async function handleSelectCandidate(candidate) {
    setPhase("working");
    setError(null);
    try {
      const res = await selectItemImage(slug, categoryName, item.name, candidate.url, candidate.thumbUrl);
      applyNewImage(res.imageUrl);
    } catch (err) {
      setError(err.message);
      setPhase("idle");
    }
  }

  async function handleAIGenerate() {
    setPhase("working");
    setError(null);
    const selectedModel = AI_MODELS.find((m) => m.id === aiModelId);
    try {
      const notes = [contextHint.trim(), item.itemInfo].filter(Boolean).join(" · ");
      const res = await generateItemImage(slug, categoryName, item.name, notes || undefined, {
        provider: selectedModel?.provider,
        model: selectedModel?.model,
        quality: selectedModel?.quality,
      });
      applyNewImage(res.imageUrl);
    } catch (err) {
      setError(err.message);
      setPhase("idle");
    }
  }

  return (
    <div className="item-img-editor">
      {/* Current image preview */}
      <div className="refine-current">
        {displaySrc
          ? <img src={displaySrc} alt={item.name} className="refine-current__img" />
          : <div className="refine-current__empty">No image yet</div>}
      </div>

      {/* Context chips */}
      {contextPills.length > 0 && (
        <div className="bgi-context">
          <span className="bgi-context__label">Context:</span>
          {contextPills.map((p) => <span key={p} className="bgi-context__chip">{p}</span>)}
        </div>
      )}

      {/* Tabs — Fix only available when image exists */}
      {hasExistingImage && (
        <div className="refine-tabs">
          <button
            className={`refine-tab ${tab === "fix" ? "refine-tab--active" : ""}`}
            onClick={() => { setTab("fix"); setPhase("idle"); setError(null); setCandidates([]); }}
            disabled={busy}
          >
            ✏️ Fix this image
          </button>
          <button
            className={`refine-tab ${tab === "replace" ? "refine-tab--active" : ""}`}
            onClick={() => { setTab("replace"); setPhase("idle"); setError(null); setCandidates([]); }}
            disabled={busy}
          >
            🔄 Replace
          </button>
        </div>
      )}

      {error && <div className="img-cat-card__error">{error}</div>}

      {/* ── Fix tab ── */}
      {tab === "fix" && (
        <>
          <div className="refine-hint">
            <label className="refine-hint__label">What's wrong with this image?</label>
            <textarea
              className="settings-textarea"
              rows={3}
              placeholder={"e.g. \"The technician has 3 hands — fix the anatomy\"\n\"Make it residential, not commercial\"\n\"Lighting is too dark, make it bright and sunny\""}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="refine-actions">
            {phase === "working"
              ? <div className="refine-status" style={{ flex: 1 }}>Editing image with AI…</div>
              : (
                <button
                  className="btn btn--primary"
                  style={{ flex: 1 }}
                  onClick={handleFix}
                  disabled={!feedback.trim() || busy}
                >
                  🔧 Fix with AI
                </button>
              )
            }
            {phase === "done" && onDone && (
              <button className="btn btn--secondary" onClick={onDone}>Done</button>
            )}
            {phase === "done" && !onDone && (
              <button className="btn btn--secondary" onClick={() => { setPhase("idle"); setTab("fix"); }}>
                Fix again
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Replace tab ── */}
      {tab === "replace" && (
        <>
          <div className="refine-hint">
            <label className="refine-hint__label">
              Extra detail <span className="refine-hint__optional">optional</span>
            </label>
            <input
              className="settings-input"
              placeholder={`e.g. "rooftop unit", "crawl space liner", "residential attic"`}
              value={contextHint}
              onChange={(e) => setContextHint(e.target.value)}
              disabled={busy}
              onKeyDown={(e) => e.key === "Enter" && !busy && handleWebSearch()}
            />
          </div>

          {candidates.length > 0 && (
            <div className="refine-candidates">
              {candidates.map((c, i) => (
                <button key={i} className="refine-candidate" onClick={() => handleSelectCandidate(c)} disabled={busy}>
                  <img src={c.thumbUrl} alt={`Option ${i + 1}`} className="refine-candidate__img" />
                  <span className="refine-candidate__domain">{c.domain}</span>
                </button>
              ))}
            </div>
          )}

          {phase === "searching" && <div className="refine-status">Searching web…</div>}
          {phase === "working"   && <div className="refine-status">Generating image…</div>}

          {/* AI model selector */}
          {phase !== "working" && (
            <div className="refine-model-picker">
              {AI_MODELS.map((m) => (
                <button
                  key={m.id}
                  className={`refine-model-btn ${aiModelId === m.id ? "refine-model-btn--active" : ""}`}
                  onClick={() => setAiModelId(m.id)}
                  disabled={busy}
                  title={m.badge}
                >
                  <span>{m.label}</span>
                  <span className="refine-model-btn__cost">${m.cost}/img</span>
                </button>
              ))}
            </div>
          )}

          <div className="refine-actions">
            {phase !== "working" && (
              <>
                <button className="btn btn--secondary" style={{ flex: 1 }} onClick={handleWebSearch} disabled={busy}>
                  🌐 {candidates.length > 0 ? "Search again" : "Web Search"}
                </button>
                <button className="btn btn--primary" style={{ flex: 1 }} onClick={handleAIGenerate} disabled={busy}>
                  ✨ AI Generate
                </button>
              </>
            )}
            {phase === "done" && onDone && (
              <button className="btn btn--secondary" onClick={onDone} style={{ width: "100%" }}>Done</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Item Refine Modal — modal wrapper around ItemImageEditor ──────────────────

function ItemRefineModal({ slug, item, categoryName, orgContext, onImageChange, onClose }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-box modal-box--refine">
        <div className="modal-box__header">
          <div>
            <div className="bgi-header__eyebrow">Image</div>
            <h3 className="bgi-header__title" style={{ fontSize: 15 }}>{item.name}</h3>
          </div>
          <button className="modal-box__close" onClick={onClose}>✕</button>
        </div>
        <ItemImageEditor
          slug={slug}
          item={item}
          categoryName={categoryName}
          orgContext={orgContext}
          onImageChange={onImageChange}
          onDone={onClose}
        />
      </div>
    </div>
  );
}

// ── Price Book Panel ──────────────────────────────────────────────────────────

function ItemDetailEdit({ slug, item, categoryName, orgContext, factors, additionalCosts, onUpdate, onClose }) {
  const [form, setForm] = useState({ ...item });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleName = (key, name) => {
    const current = form[key] || [];
    set(key, current.includes(name) ? current.filter((value) => value !== name) : [...current, name]);
  };

  return (
    <div className="item-detail-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="item-detail-box">
        <div className="item-detail-box__header">
          <div>
            <div className="item-detail-box__breadcrumb">Items › {categoryName}</div>
            <h2 className="item-detail-box__title">Edit Item</h2>
          </div>
          <button className="modal-box__close" onClick={onClose}>✕</button>
        </div>

        <div className="item-detail-box__body">
          {/* Left — fields */}
          <div className="item-detail-box__left">
            <Field label={<>Item Name <span className="settings-required">*</span></>}>
              <input className="settings-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>

            <Field label="Item Category">
              <input className="settings-input" value={categoryName} disabled style={{ background: "#f9fafb", color: "#6b7280" }} />
            </Field>

            <Field label="Item Info" hint="Customer-facing description posted to the API price book — what's included, the materials/method, and why it matters.">
              <textarea
                className="settings-textarea"
                rows={6}
                value={form.itemInfo || ""}
                onChange={(e) => set("itemInfo", e.target.value)}
                placeholder="Supply and install... Includes... Ideal for..."
              />
            </Field>

            <div className="item-detail-box__section-title">Pricing</div>

            <div className="item-detail-pricing-grid">
              <Field label={<>Unit Type <span className="settings-required">*</span></>}>
                <select className="settings-select" value={form.unit} onChange={(e) => set("unit", e.target.value)}>
                  {["Sq. Ft.", "Linear Feet", "Each", "Hours", "Big Sq.", "Dollars"].map((u) => <option key={u}>{u}</option>)}
                </select>
              </Field>
              <Field label={<>Material Cost <span className="settings-required">*</span></>}>
                <input className="settings-input" type="number" step="0.01" value={form.materialCost} onChange={(e) => set("materialCost", parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label={<>Labor Hours <span className="settings-required">*</span></>}>
                <input className="settings-input" type="number" step="0.001" value={form.laborHours} onChange={(e) => set("laborHours", parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Multiplier Override" hint="Leave blank to use branch pricing.">
                <input className="settings-input" type="number" step="0.01" value={form.multiplierOverride || ""} placeholder="Leave blank" onChange={(e) => set("multiplierOverride", e.target.value)} />
              </Field>
            </div>

            <div className="item-detail-checkboxes">
              <label className="pb-checkbox-label">
                <input type="checkbox" checked={!!form.subItem} onChange={(e) => set("subItem", e.target.checked)} />
                Sub Item
                <span className="settings-field__hint" style={{ marginLeft: 4, display: "inline" }}>(lists under Sub Services in job breakdown)</span>
              </label>
              <label className="pb-checkbox-label">
                <input type="checkbox" checked={!!form.requiresInfo} onChange={(e) => set("requiresInfo", e.target.checked)} />
                Requires Info
              </label>
            </div>

            <div className="item-detail-box__section-title">API Relations</div>
            <Field label="Factors" hint="These names resolve to factor IDs when the org is deployed.">
              <div className="pb-checkbox-grid">
                {factors.map((factor) => (
                  <label key={factor.name} className="pb-checkbox-label">
                    <input type="checkbox" checked={(form.factorNames || []).includes(factor.name)} onChange={() => toggleName("factorNames", factor.name)} />
                    {factor.name}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Additional Costs" hint="These names resolve to additional-cost IDs when the org is deployed.">
              <div className="pb-checkbox-grid">
                {additionalCosts.map((cost) => (
                  <label key={cost.name} className="pb-checkbox-label">
                    <input type="checkbox" checked={(form.additionalCostNames || []).includes(cost.name)} onChange={() => toggleName("additionalCostNames", cost.name)} />
                    {cost.name}
                  </label>
                ))}
              </div>
            </Field>
          </div>

          {/* Right — image editor (same as standalone modal) */}
          <div className="item-detail-box__right">
            <ItemImageEditor
              slug={slug}
              item={form}
              categoryName={categoryName}
              orgContext={orgContext}
              onImageChange={(url) => setForm((f) => ({ ...f, imageUrl: url, imageUpdatedAt: Date.now() }))}
            />
          </div>
        </div>

        <div className="item-detail-box__footer">
          <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={() => { onUpdate(form); onClose(); }}>Save Item</button>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ slug, item, categoryName, orgContext, factors, additionalCosts, selected, onToggleSelect, onUpdate, onDelete }) {
  const [showDetail, setShowDetail] = useState(false);
  const [showRefine, setShowRefine] = useState(false);

  function handleImageChange(url) {
    onUpdate({ ...item, imageUrl: url, imageUpdatedAt: Date.now() });
  }

  const thumbSrc = item.imageUrl
    ? `${item.imageUrl}?t=${item.imageUpdatedAt || 0}`
    : null;

  return (
    <>
      <div className={`pb-item-row ${selected ? "pb-item-row--selected" : ""}`}>
        {/* Selection checkbox */}
        <label className="pb-item-row__check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={!!selected} onChange={onToggleSelect} />
        </label>
        <div className="pb-item-row__left">
          {/* Thumbnail — click to refine */}
          <button className="pb-item-row__thumb-btn" onClick={() => setShowRefine(true)} title="Refine image">
            {thumbSrc
              ? <img src={thumbSrc} alt="" className="pb-item-row__thumb" />
              : <div className="pb-item-row__thumb pb-item-row__thumb--empty" />}
            <div className="pb-item-row__thumb-overlay">↺</div>
          </button>
          <div className="pb-item-row__info">
            <span className="pb-item-row__name">{item.name}</span>
            <span className="pb-item-row__meta">{item.unit} · ${item.materialCost} · {item.laborHours}h</span>
            {item.itemInfo && <span className="pb-item-row__desc">{item.itemInfo.slice(0, 100)}{item.itemInfo.length > 100 ? "…" : ""}</span>}
          </div>
        </div>
        <div className="pb-item-row__actions">
          <button className="pb-btn-icon" onClick={() => setShowDetail(true)} title="Edit">✎</button>
          <button className="pb-btn-icon pb-btn-icon--danger" onClick={onDelete} title="Delete">✕</button>
        </div>
      </div>

      {showDetail && (
        <ItemDetailEdit
          slug={slug}
          item={item}
          categoryName={categoryName}
          orgContext={orgContext}
          factors={factors}
          additionalCosts={additionalCosts}
          onUpdate={onUpdate}
          onClose={() => setShowDetail(false)}
        />
      )}

      {showRefine && (
        <ItemRefineModal
          slug={slug}
          item={item}
          categoryName={categoryName}
          orgContext={orgContext}
          onImageChange={handleImageChange}
          onClose={() => setShowRefine(false)}
        />
      )}
    </>
  );
}

function AddItemForm({ onAdd, onCancel }) {
  const [form, setForm] = useState({ name: "", itemInfo: "", unit: "Each", materialCost: 0, laborHours: 0, multiplierOverride: null, subItem: false, requiresInfo: false, factorNames: [], additionalCostNames: [], imageUrl: null, imageSource: null });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="pb-item-edit pb-item-edit--new">
      <Field label={<>Item Name <span className="settings-required">*</span></>}>
        <input className="settings-input" placeholder="Service name" value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Item Info" hint="Customer-facing description posted to the API — what's included and why it matters.">
        <textarea className="settings-textarea" rows={4} placeholder="Supply and install... Includes... Ideal for..." value={form.itemInfo} onChange={(e) => set("itemInfo", e.target.value)} />
      </Field>
      <div className="pb-item-edit__grid">
        <Field label="Unit">
          <select className="settings-select" value={form.unit} onChange={(e) => set("unit", e.target.value)}>
            {["Sq. Ft.", "Linear Feet", "Each", "Hours", "Big Sq.", "Dollars"].map((u) => <option key={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Material Cost ($)">
          <input className="settings-input" type="number" step="0.01" value={form.materialCost} onChange={(e) => set("materialCost", parseFloat(e.target.value) || 0)} />
        </Field>
        <Field label="Labor Hours">
          <input className="settings-input" type="number" step="0.001" value={form.laborHours} onChange={(e) => set("laborHours", parseFloat(e.target.value) || 0)} />
        </Field>
      </div>
      <div className="pb-item-edit__actions">
        <button className="btn btn--secondary" onClick={onCancel}>Cancel</button>
        <button className="btn btn--primary" onClick={() => { if (form.name.trim()) onAdd(form); }}>Add Item</button>
      </div>
    </div>
  );
}

function CategoryBlock({ slug, cat, catIndex, orgContext, factors, additionalCosts, selectedItems, onToggleSelect, onUpdateCat, onDeleteCat }) {
  const [expanded, setExpanded] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(cat.name);
  const [bulkModal, setBulkModal] = useState(false);

  const updateItem = (itemIdx, updated) => {
    const items = [...cat.items];
    items[itemIdx] = updated;
    onUpdateCat({ ...cat, items });
  };

  const deleteItem = (itemIdx) => {
    if (!window.confirm(`Delete "${cat.items[itemIdx].name}"?`)) return;
    onUpdateCat({ ...cat, items: cat.items.filter((_, i) => i !== itemIdx) });
  };

  const addItem = (item) => { onUpdateCat({ ...cat, items: [...cat.items, item] }); setAddingItem(false); };

  const imagesCount = cat.items.filter((i) => i.imageUrl).length;
  const selectedInCat = cat.items.filter((item) => selectedItems?.has(`${cat.name}|||${item.name}`)).length;
  const allSelectedInCat = selectedInCat === cat.items.length;

  function handleToggleAllInCat(e) {
    e.stopPropagation();
    cat.items.forEach((item) => {
      const key = `${cat.name}|||${item.name}`;
      const isSelected = selectedItems?.has(key);
      if (allSelectedInCat ? isSelected : !isSelected) {
        onToggleSelect(cat.name, item.name);
      }
    });
  }

  const toggleFactor = (factorName) => {
    const current = cat.factorNames || [];
    onUpdateCat({
      ...cat,
      factorNames: current.includes(factorName) ? current.filter((name) => name !== factorName) : [...current, factorName],
    });
  };

  return (
    <div className="pb-category">
      <div className="pb-category__header" onClick={() => setExpanded((v) => !v)}>
        <div className="pb-category__left">
          <span className="pb-category__chevron">{expanded ? "▾" : "▸"}</span>
          {editingName ? (
            <input
              className="settings-input pb-category__name-input"
              value={nameVal}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={() => { onUpdateCat({ ...cat, name: nameVal }); setEditingName(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onUpdateCat({ ...cat, name: nameVal }); setEditingName(false); }
                if (e.key === "Escape") { setNameVal(cat.name); setEditingName(false); }
              }}
              autoFocus
            />
          ) : (
            <span className="pb-category__name">{cat.name}</span>
          )}
          <span className="pb-category__count">{cat.items.length} items</span>
          {imagesCount > 0 && <span className="pb-category__count" style={{ background: "#d1fae5", color: "#065f46" }}>{imagesCount} images</span>}
          {selectedInCat > 0 && <span className="pb-category__count" style={{ background: "#dbeafe", color: "#1d4ed8" }}>{selectedInCat} selected</span>}
        </div>
        <div className="pb-category__actions" onClick={(e) => e.stopPropagation()}>
          {/* Select all in category */}
          <label className="pb-cat-check" title={allSelectedInCat ? "Deselect all" : "Select all"} onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={allSelectedInCat && cat.items.length > 0} ref={(el) => { if (el) el.indeterminate = selectedInCat > 0 && !allSelectedInCat; }} onChange={handleToggleAllInCat} />
          </label>
          <button className="pb-btn-icon" title="Queue category images" onClick={() => { setExpanded(true); setBulkModal(true); }}>✨</button>
          <button className="pb-btn-icon" onClick={() => { setEditingName(true); setExpanded(true); }} title="Rename">✎</button>
          <button className="pb-btn-icon pb-btn-icon--danger" onClick={() => onDeleteCat(catIndex)} title="Delete category">✕</button>
        </div>
      </div>

      {expanded && (
        <div className="pb-category__body">
          <Field label="Display Title" hint="Posted as the category title in the API.">
            <input className="settings-input" value={cat.title || cat.name} onChange={(e) => onUpdateCat({ ...cat, title: e.target.value })} />
          </Field>
          <Field label="Category Factors" hint="Factors available for this category after deployment.">
            <div className="pb-checkbox-grid">
              {factors.map((factor) => (
                <label key={factor.name} className="pb-checkbox-label">
                  <input type="checkbox" checked={(cat.factorNames || []).includes(factor.name)} onChange={() => toggleFactor(factor.name)} />
                  {factor.name}
                </label>
              ))}
            </div>
          </Field>
          {cat.items.map((item, itemIdx) => (
            <ItemRow
              key={itemIdx}
              slug={slug}
              item={item}
              categoryName={cat.name}
              orgContext={orgContext}
              factors={factors}
              additionalCosts={additionalCosts}
              selected={!!selectedItems?.has(`${cat.name}|||${item.name}`)}
              onToggleSelect={() => onToggleSelect?.(cat.name, item.name)}
              onUpdate={(updated) => updateItem(itemIdx, updated)}
              onDelete={() => deleteItem(itemIdx)}
            />
          ))}
          {addingItem
            ? <AddItemForm onAdd={addItem} onCancel={() => setAddingItem(false)} />
            : <button className="pb-add-item-btn" onClick={() => setAddingItem(true)}>+ Add Item</button>}
        </div>
      )}

      {bulkModal && (
        <BulkGenerateModal
          slug={slug}
          cat={cat}
          orgContext={orgContext}
          onClose={() => setBulkModal(false)}
          onDone={(results) => {
            const now = Date.now();
            const updatedItems = cat.items.map((item) => {
              const r = results.find((r) => r.itemName === item.name && r.success && r.imageUrl);
              return r ? { ...item, imageUrl: r.imageUrl, imageUpdatedAt: now, imageSource: r.imageSource || item.imageSource, sourceUrl: r.sourceUrl || item.sourceUrl } : item;
            });
            onUpdateCat({ ...cat, items: updatedItems });
            setBulkModal(false);
          }}
        />
      )}
    </div>
  );
}

function PriceBookPanel({ org, onSaved }) {
  const [categories, setCategories] = useState(org.resources?.categories || []);
  const [workAreas, setWorkAreas] = useState(org.resources?.workAreas || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [improving, setImproving] = useState(false);

  // ── Bulk selection ───────────────────────────────────────────────────────────
  const [selectedItems, setSelectedItems] = useState(new Set()); // "catName|||itemName"
  const [concurrency, setConcurrency] = useState(4);             // parallel image generations

  function toggleSelectItem(categoryName, itemName) {
    const key = `${categoryName}|||${itemName}`;
    setSelectedItems((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  // Select every item across the whole catalog that has no image yet — so the
  // bulk queue only generates the missing ones (resumes a partial run).
  function selectUngenerated() {
    const keys = [];
    for (const cat of categories) {
      for (const item of cat.items) {
        if (!item.imageUrl) keys.push(`${cat.name}|||${item.name}`);
      }
    }
    setSelectedItems(new Set(keys));
  }
  const ungeneratedCount = categories.reduce(
    (s, c) => s + c.items.filter((i) => !i.imageUrl).length,
    0,
  );

  // ── Image queue ──────────────────────────────────────────────────────────────
  const [queue, setQueue] = useState([]);        // [{id, categoryName, itemName, notes, status, imageUrl, error, ts}]
  const [queueRunning, setQueueRunning] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const queueAbortRef = useRef(false);

  function updateItemInCategories(categoryName, itemName, patch) {
    setCategories((cats) => cats.map((cat) =>
      cat.name !== categoryName ? cat : {
        ...cat,
        items: cat.items.map((item) =>
          item.name !== itemName ? item : { ...item, ...patch }
        ),
      }
    ));
    setDirty(true);
  }

  // Process one queued item (generate/select its image + persist).
  async function processQueueItem(qItem, mode) {
    setQueue((q) => q.map((i) => i.id === qItem.id ? { ...i, status: "running" } : i));
    try {
      let imageUrl;
      if (mode.mode === "web") {
        const candidates = await fetchItemCandidates(org.slug, qItem.categoryName, qItem.itemName, { count: 1 });
        if (!candidates.length) throw new Error("No web candidates found");
        const res = await selectItemImage(org.slug, qItem.categoryName, qItem.itemName, candidates[0].url, candidates[0].thumbUrl);
        imageUrl = res.imageUrl;
      } else {
        const res = await generateItemImage(org.slug, qItem.categoryName, qItem.itemName, qItem.notes, {
          provider: mode.provider,
          model: mode.model,
          quality: mode.quality,
          comment: mode.comment || "",
        });
        imageUrl = res.imageUrl;
      }
      const ts = Date.now();
      setQueue((q) => q.map((i) => i.id === qItem.id ? { ...i, status: "done", imageUrl, ts } : i));
      updateItemInCategories(qItem.categoryName, qItem.itemName, { imageUrl, imageUpdatedAt: ts });
    } catch (err) {
      setQueue((q) => q.map((i) => i.id === qItem.id ? { ...i, status: "error", error: err.message } : i));
    }
  }

  // Run the batch through a concurrency pool: `concurrency` items generate at
  // once (server serializes the JSON write) instead of one-by-one.
  async function processQueue(newItems, mode) {
    setQueueRunning(true);
    queueAbortRef.current = false;

    const jobs = [...newItems];
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length && !queueAbortRef.current) {
        await processQueueItem(jobs[cursor++], mode);
      }
    };
    const n = Math.max(1, Math.min(10, Number(concurrency) || 4));
    await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));

    setQueueRunning(false);
  }

  function handleAddToQueue(mode) {
    const newItems = [...selectedItems].map((key) => {
      const [categoryName, itemName] = key.split("|||");
      const cat = categories.find((c) => c.name === categoryName);
      const item = cat?.items.find((i) => i.name === itemName);
      return {
        id: `${key}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        categoryName,
        itemName,
        notes: item?.itemInfo || "",
        status: "pending",
        imageUrl: null,
        error: null,
        ts: null,
      };
    });

    setQueue((q) => [...q, ...newItems]);
    setSelectedItems(new Set());
    setShowQueue(true);
    processQueue(newItems, mode);
  }

  const markDirty = useCallback((cats) => { setCategories(cats); setDirty(true); setStatus(null); }, []);

  const updateCat = (idx, updated) => {
    const previousName = categories[idx].name;
    const cats = [...categories];
    cats[idx] = updated;
    if (previousName !== updated.name) {
      setWorkAreas((areas) => areas.map((area) => ({
        ...area,
        categories: (area.categories || []).map((name) => name === previousName ? updated.name : name),
      })));
    }
    markDirty(cats);
  };
  const deleteCat = (idx) => {
    if (!window.confirm(`Delete category "${categories[idx].name}" and all its items?`)) return;
    const deletedName = categories[idx].name;
    setWorkAreas((areas) => areas.map((area) => ({
      ...area,
      categories: (area.categories || []).filter((name) => name !== deletedName),
    })));
    markDirty(categories.filter((_, i) => i !== idx));
  };
  const addCat = () => {
    if (!newCatName.trim()) return;
    markDirty([...categories, { name: newCatName.trim(), title: newCatName.trim(), factorNames: [], items: [] }]);
    setNewCatName(""); setAddingCat(false);
  };

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateOrgResources(org.slug, { categories, workAreas });
      onSaved(updated);
      setDirty(false);
      setStatus("saved");
      setTimeout(() => setStatus(null), 3000);
    } catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  // Regenerate every item's customer-facing description into richer 3-5 sentence
  // copy. The endpoint operates on the saved org and persists immediately, so we
  // require a clean (saved) state first, then sync local state from the result.
  async function handleImproveDescriptions() {
    if (dirty) {
      window.alert("Please save your pending Price Book changes before improving descriptions.");
      return;
    }
    if (!window.confirm(`Rewrite the description for all ${categories.reduce((s, c) => s + c.items.length, 0)} items with AI? This replaces the current descriptions and saves immediately.`)) return;
    setImproving(true);
    setStatus(null);
    try {
      const updated = await improveItemDescriptions(org.slug);
      setCategories(updated.resources?.categories || []);
      setWorkAreas(updated.resources?.workAreas || []);
      onSaved(updated);
      setDirty(false);
      setStatus("saved");
      setTimeout(() => setStatus(null), 3000);
    } catch { setStatus("error"); }
    finally { setImproving(false); }
  }

  const totalItems = categories.reduce((s, c) => s + c.items.length, 0);
  const totalImages = categories.reduce((s, c) => s + c.items.filter((i) => i.imageUrl).length, 0);
  const selectedCount = selectedItems.size;

  return (
    <>
      <div className="settings-header">
        <h2 className="settings-header__title">Price Book</h2>
        <p className="settings-header__desc">
          {categories.length} categories · {totalItems} items · {totalImages} images.
          {" "}Check items to bulk generate images, or click ✨ per category.
        </p>
      </div>

      <div className="img-style-suggest-row">
        <div className="img-style-suggest-info">
          <span className="img-style-suggest-info__icon">✨</span>
          <span>Rewrite every item's customer-facing description into richer proposal copy</span>
        </div>
        <button className="btn btn--secondary" onClick={handleImproveDescriptions} disabled={improving || saving || totalItems === 0}>
          {improving ? "Improving…" : "Improve descriptions with AI"}
        </button>
      </div>

      {/* Quick-select: grab every item that still has no image (resume a partial run). */}
      <div className="pb-select-bar">
        <button
          className="btn btn--secondary btn--sm"
          onClick={selectUngenerated}
          disabled={ungeneratedCount === 0}
          title="Select all items across every category that don't have an image yet"
        >
          Select all without image ({ungeneratedCount})
        </button>
        {selectedCount > 0 && (
          <button className="btn btn--secondary btn--sm" onClick={() => setSelectedItems(new Set())}>
            Clear selection
          </button>
        )}
        <label className="pb-select-bar__parallel" title="How many images to generate at the same time">
          Parallel
          <input
            type="number"
            min="1"
            max="10"
            className="settings-input"
            value={concurrency}
            onChange={(e) => setConcurrency(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            disabled={queueRunning}
          />
        </label>
      </div>

      {/* Selection toolbar — shown when at least one item is checked */}
      {selectedCount > 0 && (
        <SelectionToolbar
          count={selectedCount}
          running={queueRunning}
          onAddToQueue={handleAddToQueue}
          onClearSelection={() => setSelectedItems(new Set())}
        />
      )}

      <div className="pb-categories">
        {categories.map((cat, idx) => (
          <CategoryBlock
            key={idx}
            slug={org.slug}
            cat={cat}
            catIndex={idx}
            orgContext={{ industry: org.industry, region: org.region }}
            factors={org.resources?.factors || []}
            additionalCosts={org.resources?.additionalCosts || []}
            selectedItems={selectedItems}
            onToggleSelect={toggleSelectItem}
            onUpdateCat={(updated) => updateCat(idx, updated)}
            onDeleteCat={deleteCat}
          />
        ))}
        {addingCat ? (
          <div className="pb-add-cat-form">
            <input className="settings-input" placeholder="Category name" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCat(); if (e.key === "Escape") { setAddingCat(false); setNewCatName(""); } }} autoFocus />
            <button className="btn btn--primary" onClick={addCat}>Add</button>
            <button className="btn btn--secondary" onClick={() => { setAddingCat(false); setNewCatName(""); }}>Cancel</button>
          </div>
        ) : (
          <button className="pb-add-cat-btn" onClick={() => setAddingCat(true)}>+ Add Category</button>
        )}
      </div>

      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setCategories(org.resources?.categories || []); setWorkAreas(org.resources?.workAreas || []); setDirty(false); setStatus(null); }} />

      {/* Floating queue panel — shown while queue has items */}
      {showQueue && queue.length > 0 && (
        <QueuePanel
          queue={queue}
          running={queueRunning}
          onStop={() => { queueAbortRef.current = true; }}
          onClear={() => { setQueue([]); setShowQueue(false); }}
          onClose={() => setShowQueue(false)}
        />
      )}

      {/* Re-open queue button when hidden but still running */}
      {!showQueue && queue.length > 0 && (
        <button
          className="queue-reopen-btn"
          onClick={() => setShowQueue(true)}
        >
          {queueRunning ? "⟳" : "✓"} Queue ({queue.filter((i) => i.status === "done").length}/{queue.length})
        </button>
      )}
    </>
  );
}

// ── Work Areas / Factors / Additional Costs / Multiplier Ranges — unchanged ──

function WorkAreasPanel({ org, onSaved }) {
  const allCatNames = (org.resources?.categories || []).map((c) => c.name);
  const [workAreas, setWorkAreas] = useState(org.resources?.workAreas || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [newWaName, setNewWaName] = useState("");
  const [expandedIdx, setExpandedIdx] = useState(null);

  const mark = (was) => { setWorkAreas(was); setDirty(true); setStatus(null); };
  const toggleCategory = (waIdx, catName) => {
    const was = [...workAreas];
    const wa = { ...was[waIdx] };
    const cats = wa.categories || [];
    wa.categories = cats.includes(catName) ? cats.filter((c) => c !== catName) : [...cats, catName];
    was[waIdx] = wa; mark(was);
  };
  const toggleFactor = (waIdx, factorName) => {
    const was = [...workAreas];
    const wa = { ...was[waIdx] };
    const names = wa.factorNames || [];
    wa.factorNames = names.includes(factorName) ? names.filter((name) => name !== factorName) : [...names, factorName];
    was[waIdx] = wa;
    mark(was);
  };
  const addWa = () => { if (!newWaName.trim()) return; mark([...workAreas, { name: newWaName.trim(), categories: [], factorNames: [] }]); setNewWaName(""); };
  const deleteWa = (idx) => { if (!window.confirm(`Delete work area "${workAreas[idx].name}"?`)) return; mark(workAreas.filter((_, i) => i !== idx)); };
  const updateName = (idx, name) => { const was = [...workAreas]; was[idx] = { ...was[idx], name }; mark(was); };

  async function handleSave() {
    setSaving(true);
    try { const updated = await updateOrgResources(org.slug, { workAreas }); onSaved(updated); setDirty(false); setStatus("saved"); setTimeout(() => setStatus(null), 3000); }
    catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="settings-header"><h2 className="settings-header__title">Work Areas</h2><p className="settings-header__desc">Physical zones where work is performed. Each links to relevant item categories.</p></div>
      <div className="pb-categories">
        {workAreas.map((wa, idx) => (
          <div key={idx} className="pb-category">
            <div className="pb-category__header" onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}>
              <div className="pb-category__left">
                <span className="pb-category__chevron">{expandedIdx === idx ? "▾" : "▸"}</span>
                <span className="pb-category__name">{wa.name}</span>
                <span className="pb-category__count">{(wa.categories || []).length} categories</span>
              </div>
              <div className="pb-category__actions" onClick={(e) => e.stopPropagation()}>
                <button className="pb-btn-icon pb-btn-icon--danger" onClick={() => deleteWa(idx)}>✕</button>
              </div>
            </div>
            {expandedIdx === idx && (
              <div className="pb-category__body">
                <Field label="Work Area Name"><input className="settings-input" value={wa.name} onChange={(e) => updateName(idx, e.target.value)} /></Field>
                <Field label="Linked Categories" hint="Categories that apply to this work area.">
                  <div className="pb-checkbox-grid">
                    {allCatNames.map((cn) => (
                      <label key={cn} className="pb-checkbox-label">
                        <input type="checkbox" checked={(wa.categories || []).includes(cn)} onChange={() => toggleCategory(idx, cn)} />{cn}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Work Area Factors" hint="Factors available for this work area after deployment.">
                  <div className="pb-checkbox-grid">
                    {(org.resources?.factors || []).map((factor) => (
                      <label key={factor.name} className="pb-checkbox-label">
                        <input type="checkbox" checked={(wa.factorNames || []).includes(factor.name)} onChange={() => toggleFactor(idx, factor.name)} />{factor.name}
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
            )}
          </div>
        ))}
        <div className="pb-add-cat-form">
          <input className="settings-input" placeholder="New work area name (e.g. Attic, Crawl Space)" value={newWaName} onChange={(e) => setNewWaName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addWa()} />
          <button className="btn btn--secondary" onClick={addWa}>+ Add Work Area</button>
        </div>
      </div>
      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setWorkAreas(org.resources?.workAreas || []); setDirty(false); setStatus(null); }} />
    </>
  );
}

function FactorsPanel({ org, onSaved }) {
  const [factors, setFactors] = useState(org.resources?.factors || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [newFactor, setNewFactor] = useState({ name: "", factor: 1.0, appliesTo: "Material Cost", alwaysEnabled: false });

  const mark = (fs) => { setFactors(fs); setDirty(true); setStatus(null); };
  const updateFactor = (idx, field, val) => { const fs = [...factors]; fs[idx] = { ...fs[idx], [field]: val }; mark(fs); };
  const deleteFactor = (idx) => { if (factors[idx].alwaysEnabled) return alert("Cannot delete the Standard factor."); mark(factors.filter((_, i) => i !== idx)); };
  const addFactor = () => { if (!newFactor.name.trim()) return; mark([...factors, { ...newFactor, factor: parseFloat(newFactor.factor) || 1.0 }]); setNewFactor({ name: "", factor: 1.0, appliesTo: "Material Cost", alwaysEnabled: false }); };

  async function handleSave() {
    setSaving(true);
    try { const updated = await updateOrgResources(org.slug, { factors }); onSaved(updated); setDirty(false); setStatus("saved"); setTimeout(() => setStatus(null), 3000); }
    catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="settings-header"><h2 className="settings-header__title">Factors</h2><p className="settings-header__desc">Labor and material multipliers applied based on job conditions.</p></div>
      <Card title={`Factors (${factors.length})`}>
        <div className="factors-table">
          <div className="factors-table__head"><span>Name</span><span>Multiplier</span><span>Applies To</span><span>Always On</span><span></span></div>
          {factors.map((f, idx) => (
            <div key={idx} className="factors-table__row">
              <input className="settings-input settings-input--sm" value={f.name} disabled={f.alwaysEnabled} onChange={(e) => updateFactor(idx, "name", e.target.value)} />
              <input className="settings-input settings-input--sm" type="number" step="0.01" value={f.factor} disabled={f.alwaysEnabled} onChange={(e) => updateFactor(idx, "factor", parseFloat(e.target.value) || 1)} />
              <select className="settings-select settings-select--sm" value={f.appliesTo} disabled={f.alwaysEnabled} onChange={(e) => updateFactor(idx, "appliesTo", e.target.value)}>
                <option>Material Cost</option><option>Labor Cost</option>
              </select>
              <input type="checkbox" checked={f.alwaysEnabled} disabled onChange={() => {}} />
              <button className="pb-btn-icon pb-btn-icon--danger" disabled={f.alwaysEnabled} onClick={() => deleteFactor(idx)}>✕</button>
            </div>
          ))}
          <div className="factors-table__row factors-table__row--new">
            <input className="settings-input settings-input--sm" placeholder="Factor name" value={newFactor.name} onChange={(e) => setNewFactor({ ...newFactor, name: e.target.value })} />
            <input className="settings-input settings-input--sm" type="number" step="0.01" value={newFactor.factor} onChange={(e) => setNewFactor({ ...newFactor, factor: e.target.value })} />
            <select className="settings-select settings-select--sm" value={newFactor.appliesTo} onChange={(e) => setNewFactor({ ...newFactor, appliesTo: e.target.value })}><option>Material Cost</option><option>Labor Cost</option></select>
            <span />
            <button className="btn btn--secondary" onClick={addFactor}>+ Add</button>
          </div>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setFactors(org.resources?.factors || []); setDirty(false); setStatus(null); }} />
    </>
  );
}

function AdditionalCostsPanel({ org, onSaved }) {
  const [costs, setCosts] = useState(org.resources?.additionalCosts || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [newCost, setNewCost] = useState({ name: "", cost: 0, appliesTo: "Material Cost" });

  const mark = (cs) => { setCosts(cs); setDirty(true); setStatus(null); };
  const updateCost = (idx, field, val) => { const cs = [...costs]; cs[idx] = { ...cs[idx], [field]: val }; mark(cs); };
  const addCost = () => { if (!newCost.name.trim()) return; mark([...costs, { ...newCost, cost: parseFloat(newCost.cost) || 0 }]); setNewCost({ name: "", cost: 0, appliesTo: "Material Cost" }); };

  async function handleSave() {
    setSaving(true);
    try { const updated = await updateOrgResources(org.slug, { additionalCosts: costs }); onSaved(updated); setDirty(false); setStatus("saved"); setTimeout(() => setStatus(null), 3000); }
    catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="settings-header"><h2 className="settings-header__title">Additional Costs</h2><p className="settings-header__desc">Fixed costs added to jobs — permits, disposal, equipment rental, etc.</p></div>
      <Card title={`Additional Costs (${costs.length})`}>
        <div className="factors-table">
          <div className="factors-table__head" style={{ gridTemplateColumns: "2fr 1fr 1.5fr 36px" }}><span>Name</span><span>Cost ($)</span><span>Applies To</span><span></span></div>
          {costs.map((c, idx) => (
            <div key={idx} className="factors-table__row" style={{ gridTemplateColumns: "2fr 1fr 1.5fr 36px" }}>
              <input className="settings-input settings-input--sm" value={c.name} onChange={(e) => updateCost(idx, "name", e.target.value)} />
              <input className="settings-input settings-input--sm" type="number" step="0.01" value={c.cost} onChange={(e) => updateCost(idx, "cost", parseFloat(e.target.value) || 0)} />
              <select className="settings-select settings-select--sm" value={c.appliesTo} onChange={(e) => updateCost(idx, "appliesTo", e.target.value)}><option>Material Cost</option><option>Labor Cost</option></select>
              <button className="pb-btn-icon pb-btn-icon--danger" onClick={() => mark(costs.filter((_, i) => i !== idx))}>✕</button>
            </div>
          ))}
          <div className="factors-table__row factors-table__row--new" style={{ gridTemplateColumns: "2fr 1fr 1.5fr 36px" }}>
            <input className="settings-input settings-input--sm" placeholder="Cost name" value={newCost.name} onChange={(e) => setNewCost({ ...newCost, name: e.target.value })} />
            <input className="settings-input settings-input--sm" type="number" step="0.01" value={newCost.cost} onChange={(e) => setNewCost({ ...newCost, cost: e.target.value })} />
            <select className="settings-select settings-select--sm" value={newCost.appliesTo} onChange={(e) => setNewCost({ ...newCost, appliesTo: e.target.value })}><option>Material Cost</option><option>Labor Cost</option></select>
            <button className="btn btn--secondary" onClick={addCost}>+ Add</button>
          </div>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setCosts(org.resources?.additionalCosts || []); setDirty(false); setStatus(null); }} />
    </>
  );
}

function MultiplierRangesPanel({ org, onSaved }) {
  const [ranges, setRanges] = useState(org.resources?.multiplierRanges || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const mark = (rs) => { setRanges(rs); setDirty(true); setStatus(null); };
  const updateRange = (idx, field, val) => { const rs = [...ranges]; rs[idx] = { ...rs[idx], [field]: val }; mark(rs); };

  async function handleSave() {
    setSaving(true);
    try {
      const coerced = ranges.map((r) => ({ ...r, minCost: parseFloat(r.minCost) || 0, maxCost: r.maxCost === null || r.maxCost === "" ? null : parseFloat(r.maxCost), lowestMultiple: parseFloat(r.lowestMultiple) || 1, highestMultiple: parseFloat(r.highestMultiple) || 1 }));
      const updated = await updateOrgResources(org.slug, { multiplierRanges: coerced });
      onSaved(updated); setDirty(false); setStatus("saved"); setTimeout(() => setStatus(null), 3000);
    } catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="settings-header"><h2 className="settings-header__title">Multiplier Ranges</h2><p className="settings-header__desc">Cost-based markup multipliers. Retail = (material + labor cost) × multiplier.</p></div>
      <Card title={`Multiplier Ranges (${ranges.length})`}>
        <div className="factors-table">
          <div className="factors-table__head" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 36px" }}><span>Name</span><span>Min ($)</span><span>Max ($)</span><span>Low ×</span><span>High ×</span><span></span></div>
          {ranges.map((r, idx) => (
            <div key={idx} className="factors-table__row" style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 36px" }}>
              <input className="settings-input settings-input--sm" value={r.name} onChange={(e) => updateRange(idx, "name", e.target.value)} />
              <input className="settings-input settings-input--sm" type="number" value={r.minCost} onChange={(e) => updateRange(idx, "minCost", e.target.value)} />
              <input className="settings-input settings-input--sm" type="number" value={r.maxCost ?? ""} placeholder="∞" onChange={(e) => updateRange(idx, "maxCost", e.target.value === "" ? null : e.target.value)} />
              <input className="settings-input settings-input--sm" type="number" step="0.01" value={r.lowestMultiple} onChange={(e) => updateRange(idx, "lowestMultiple", e.target.value)} />
              <input className="settings-input settings-input--sm" type="number" step="0.01" value={r.highestMultiple} onChange={(e) => updateRange(idx, "highestMultiple", e.target.value)} />
              <span />
            </div>
          ))}
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setRanges(org.resources?.multiplierRanges || []); setDirty(false); setStatus(null); }} />
    </>
  );
}

// ── Users Panel ───────────────────────────────────────────────────────────────

function UserCard({ user, slug, busy, bust, onChange, onGenAvatar, onUpload, onDeleteAvatar }) {
  const fileRef = useRef(null);
  const initials = (user.name || user.email || "?").trim().slice(0, 1).toUpperCase();
  const avatarSrc = user.avatarUrl ? `${user.avatarUrl}${bust ? `?v=${bust}` : ""}` : null;

  return (
    <Card title={user.role || "Team member"} description={user.email}>
      <div style={{ display: "flex", gap: 18 }}>
        {/* Avatar */}
        <div style={{ flexShrink: 0, width: 120, textAlign: "center" }}>
          <div style={{ width: 120, height: 120, borderRadius: 12, overflow: "hidden", background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 700, color: "#9ca3af" }}>
            {avatarSrc ? <img src={avatarSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : initials}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) onUpload(user.email, e.target.files[0]); e.target.value = ""; }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            <button className="btn btn--ai btn--sm" disabled={busy} onClick={() => onGenAvatar(user.email)}>{busy ? "…" : "✨ Generate"}</button>
            <button className="btn btn--secondary btn--sm" disabled={busy} onClick={() => fileRef.current?.click()}>Upload</button>
            {user.avatarUrl && <button className="btn btn--danger-outline btn--sm" disabled={busy} onClick={() => onDeleteAvatar(user.email)}>Remove</button>}
          </div>
        </div>
        {/* Fields */}
        <div style={{ flex: 1 }}>
          <Field label="Name">
            <input className="settings-input" value={user.name || ""} onChange={(e) => onChange(user.email, { name: e.target.value })} />
          </Field>
          <Field label="About" hint="Short professional bio shown on the user's profile (deployed to the API).">
            <textarea className="settings-textarea" rows={4} value={user.about || ""} onChange={(e) => onChange(user.email, { about: e.target.value })} placeholder="e.g. Lead estimator with 8 years in attic & insulation projects…" />
          </Field>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#6b7280" }}>
            <span><strong>Role:</strong> {user.role || "—"}</span>
            <span><strong>Branches:</strong> {(user.branches || []).join(", ") || "—"}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function UsersPanel({ org, onSaved }) {
  const [users, setUsers] = useState(org.users || []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [genAll, setGenAll] = useState(false);
  const [busyEmail, setBusyEmail] = useState(null);
  const [bust, setBust] = useState({});
  const [bulkAvatars, setBulkAvatars] = useState(null); // { done, total } while running
  const [modelId, setModelId] = useState("openai-draft"); // avatar image model
  const avatarModel = AI_MODELS.find((m) => m.id === modelId) || AI_MODELS[0];

  const onChange = (email, patch) => { setUsers((us) => us.map((u) => (u.email === email ? { ...u, ...patch } : u))); setDirty(true); setStatus(null); };

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await updateOrgUsers(org.slug, users);
      onSaved(updated); setDirty(false); setStatus("saved"); setTimeout(() => setStatus(null), 3000);
    } catch { setStatus("error"); }
    finally { setSaving(false); }
  }

  // One action: AI names + bios for everyone, then matching headshot avatars
  // (gender inferred from each generated first name) using the chosen model.
  async function handleGenerateAll() {
    if (dirty) { window.alert("Save or discard your pending edits before generating with AI."); return; }
    if (!window.confirm(`Generate realistic names, bios and headshot avatars for all ${users.length} users with AI? This replaces their current name/about/photo and saves as it goes.`)) return;
    setGenAll(true); setStatus(null);
    try {
      // 1) names + bios
      const updated = await generateUserIdentities(org.slug);
      setUsers(updated.users || []); onSaved(updated);
      // 2) avatars matched to the new names, with the selected model
      setBulkAvatars({ done: 0, total: 0 });
      const result = await bulkGenerateUserAvatars(org.slug, {
        overwrite: true,
        provider: avatarModel.provider, model: avatarModel.model, quality: avatarModel.quality,
        onProgress: (p) => {
          if (p.type === "start") setBulkAvatars({ done: 0, total: p.total });
          else if (p.type === "progress" && p.status === "done") {
            setBulkAvatars((s) => ({ ...s, done: (s?.done || 0) + 1 }));
            setUsers((us) => us.map((u) => (u.email === p.email ? { ...u, avatarUrl: p.avatarUrl } : u)));
            setBust((b) => ({ ...b, [p.email]: Date.now() }));
          }
        },
      });
      setStatus("saved"); setTimeout(() => setStatus(null), 3000);
      window.alert(`Done — generated identities and ${result.generated} avatar(s).`);
    } catch (e) { window.alert(e.message); setStatus("error"); }
    finally { setGenAll(false); setBulkAvatars(null); }
  }

  async function handleGenAvatar(email) {
    setBusyEmail(email);
    try {
      const { avatarUrl } = await generateUserAvatar(org.slug, email, { provider: avatarModel.provider, model: avatarModel.model, quality: avatarModel.quality });
      setUsers((us) => us.map((u) => (u.email === email ? { ...u, avatarUrl } : u)));
      setBust((b) => ({ ...b, [email]: Date.now() }));
    } catch (e) { window.alert(e.message); }
    finally { setBusyEmail(null); }
  }

  async function handleUpload(email, file) {
    setBusyEmail(email);
    try {
      const { avatarUrl } = await uploadUserAvatar(org.slug, email, file);
      setUsers((us) => us.map((u) => (u.email === email ? { ...u, avatarUrl } : u)));
      setBust((b) => ({ ...b, [email]: Date.now() }));
    } catch (e) { window.alert(e.message); }
    finally { setBusyEmail(null); }
  }

  async function handleDeleteAvatar(email) {
    setBusyEmail(email);
    try {
      const updated = await deleteUserAvatar(org.slug, email);
      setUsers((us) => us.map((u) => (u.email === email ? { ...u, avatarUrl: undefined } : u)));
      onSaved(updated);
    } catch (e) { window.alert(e.message); }
    finally { setBusyEmail(null); }
  }

  const running = genAll || saving || users.length === 0;
  const btnLabel = bulkAvatars
    ? `Generating avatars ${bulkAvatars.done}/${bulkAvatars.total || "…"}`
    : genAll
      ? "Generating…"
      : "Generate with AI";

  return (
    <>
      <div className="settings-header">
        <h2 className="settings-header__title">Users</h2>
        <p className="settings-header__desc">{users.length} users. Edit names and bios manually, or generate realistic identities and headshot avatars with AI. Deployed to each user's profile on the org.</p>
      </div>
      <div className="img-style-suggest-row">
        <div className="img-style-suggest-info">
          <span className="img-style-suggest-info__icon">✨</span>
          <span>Generate realistic names, bios and headshot avatars for every user (avatar gender matched to the first name)</span>
        </div>
        <div className="gen-controls">
          <select className="gen-model-select" value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={genAll || !!bulkAvatars} title="Avatar image model">
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.group} · {m.label} (${m.cost.toFixed(3)})</option>
            ))}
          </select>
          <button className="btn btn--primary" onClick={handleGenerateAll} disabled={running || !!bulkAvatars} style={{ whiteSpace: "nowrap" }}>
            {btnLabel}
          </button>
        </div>
      </div>
      {users.length === 0 && <Card title="No users"><p className="settings-header__desc">This org has no users yet.</p></Card>}
      {users.map((u) => (
        <UserCard
          key={u.email}
          user={u}
          slug={org.slug}
          busy={busyEmail === u.email}
          bust={bust[u.email]}
          onChange={onChange}
          onGenAvatar={handleGenAvatar}
          onUpload={handleUpload}
          onDeleteAvatar={handleDeleteAvatar}
        />
      ))}
      <SaveBar dirty={dirty} saving={saving} status={status} onSave={handleSave} onDiscard={() => { setUsers(org.users || []); setDirty(false); setStatus(null); }} />
    </>
  );
}

// ── Sidebar Nav ───────────────────────────────────────────────────────────────

const NAV = [
  {
    group: "GENERAL",
    items: [
      { id: "organization", label: "Organization", icon: "⊞" },
      { id: "image-style", label: "Image Style", icon: "🎨" },
      { id: "logo", label: "Logo", icon: "◈" },
    ],
  },
  {
    group: "FINANCIAL",
    items: [
      { id: "branch-config", label: "Branch Config", icon: "⚙" },
      { id: "multiplier-ranges", label: "Multiplier Ranges", icon: "×" },
      { id: "financing-terms", label: "Financing Terms", icon: "%" },
      { id: "proposal-content", label: "Proposal Content", icon: "✉" },
    ],
  },
  {
    group: "CATALOG",
    items: [
      { id: "price-book", label: "Price Book", icon: "☰" },
      { id: "work-areas", label: "Work Areas", icon: "◎" },
      { id: "factors", label: "Factors", icon: "f" },
      { id: "additional-costs", label: "Additional Costs", icon: "+" },
    ],
  },
  {
    group: "PEOPLE",
    items: [
      { id: "users", label: "Users", icon: "☺" },
    ],
  },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OrgSettingsPage() {
  const { slug, section: sectionParam } = useParams();
  const navigate = useNavigate();
  const [org, setOrg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState(sectionParam || "organization");
  const [search, setSearch] = useState("");

  useEffect(() => { setActiveSection(sectionParam || "organization"); }, [sectionParam]);

  useEffect(() => {
    getOrg(slug)
      .then((data) => { setOrg(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [slug]);

  const handleSaved = (updated) => setOrg(updated);
  const navTo = (id) => { setActiveSection(id); navigate(`/orgs/${slug}/settings/${id}`, { replace: true }); };

  const filteredNav = search.trim()
    ? NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase())) })).filter((g) => g.items.length)
    : NAV;

  if (loading) return <div className="page"><div className="dashboard-empty"><div className="spinner" /><p>Loading…</p></div></div>;
  if (error || !org) return <div className="page"><div className="dashboard-empty"><p className="error-text">{error || "Org not found"}</p><button className="btn btn--secondary" onClick={() => navigate("/")}>← Back</button></div></div>;

  const renderPanel = () => {
    switch (activeSection) {
      case "organization":      return <OrganizationPanel org={org} onSaved={handleSaved} />;
      case "image-style":       return <ImageStylePanel org={org} onSaved={handleSaved} />;
      case "logo":              return <LogoPanel org={org} />;
      case "branch-config":     return <BranchConfigPanel org={org} onSaved={handleSaved} />;
      case "financing-terms":   return <FinancingTermsPanel org={org} onSaved={handleSaved} />;
      case "proposal-content":  return <ProposalContentPanel org={org} onSaved={handleSaved} />;
      case "price-book":        return <PriceBookPanel org={org} onSaved={handleSaved} />;
      case "work-areas":        return <WorkAreasPanel org={org} onSaved={handleSaved} />;
      case "factors":           return <FactorsPanel org={org} onSaved={handleSaved} />;
      case "additional-costs":  return <AdditionalCostsPanel org={org} onSaved={handleSaved} />;
      case "multiplier-ranges": return <MultiplierRangesPanel org={org} onSaved={handleSaved} />;
      case "users":             return <UsersPanel org={org} onSaved={handleSaved} />;
      default:                  return <OrganizationPanel org={org} onSaved={handleSaved} />;
    }
  };

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <div className="settings-sidebar__top">
          <div className="settings-sidebar__org-name">{org.name}</div>
          <button className="settings-sidebar__back" onClick={() => navigate(`/orgs/${slug}`)}>← Back to Org</button>
          <div className="settings-sidebar__search-wrap">
            <input className="settings-sidebar__search" placeholder="Type here to search..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <nav className="settings-sidebar__nav">
          {filteredNav.map((group) => (
            <div key={group.group} className="settings-nav-group">
              <div className="settings-nav-group__label">{group.group}</div>
              {group.items.map((item) => (
                <button key={item.id} className={`settings-nav-item ${activeSection === item.id ? "settings-nav-item--active" : ""}`} onClick={() => navTo(item.id)}>
                  <span className="settings-nav-item__icon">{item.icon}</span>{item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main className="settings-main">{renderPanel()}</main>
    </div>
  );
}
