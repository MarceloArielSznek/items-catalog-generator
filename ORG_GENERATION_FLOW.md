# Org Generation Flow

> How the Org Generator creates a complete organization configuration, and where AI is involved.

---

## Overview

The generator takes a company website (or freeform industry description) and produces a fully configured org JSON — catalog, branch config, users, operating parameters — ready to deploy to attic-tech via API.

Two AI models are used in sequence:
- **GPT-4o** — extracts structured company data from the crawled website
- **o3** — generates the full catalog and branch operating parameters

---

## Step-by-Step Flow

### Step 1 — Company Info *(User Input)*

User enters: company name, website URL, timezone.

---

### Stage A — Website Crawl *(Automated + AI-guided)*

**Tools:** Cheerio (HTML parser) + GPT-4o-mini (URL guidance)

Two-phase crawl of up to 20 pages:

**Phase 1 — Priority-queue Cheerio crawl** (up to 14 pages):
- Crawls same-domain links in priority order: location/branch pages first, then services and contact pages
- Per page, extracts: plain text content + JSON-LD structured data (schema.org) + meta tags (description, keywords, OG tags)
- JSON-LD often contains perfectly structured business data (LocalBusiness, Service, etc.)

**Phase 2 — AI-guided supplemental crawl** (up to 6 additional pages):
- After Phase 1, GPT-4o-mini reviews the crawled content and uncrawled link list
- Identifies up to 6 links likely to contain the richest additional info: specific service pages, pricing, locations, financing
- Those pages are crawled and added to the corpus before extraction

**Output:** Rich page corpus: `{ url, text, schemas[], meta{} }` per page.

---

### Stage B — Data Extraction *(AI #1 — GPT-4o)*

**Context fed to the model:**
- Raw text from all crawled pages

**What it produces:**

| Field | Description |
|---|---|
| `companyName` | Confirmed company name |
| `phone` | Primary phone number |
| `contractorLicense` | License number if found |
| `about` | Company description |
| `services[]` | Actual services the company offers |
| `branches[]` | Locations with name and address |
| `financingTerms[]` | Financing options found on the site |
| `industry` | Detected industry category |
| `region` | Geographic market |

> This is the foundation everything else builds on. If the crawl finds nothing useful, the downstream AI has no grounding context.

---

### Step 2 — Review Extracted Data *(User Input)*

User reviews and edits what GPT-4o found:
- Correct phone, license, about text
- Add / remove / edit branches and addresses
- Fix any extraction errors

This is the **human quality gate** before the expensive generation step.

---

### Step 3 — Catalog Configuration *(User Input)*

User sets:
- **Total items** — preset (40 / 60 / 100 / 150) or custom number
- **Industry context** *(optional)* — freeform extra detail the crawl may have missed

  Examples:
  - *"Focus on commercial buildings only"*
  - *"High-end residential, emphasize energy efficiency upgrades"*
  - *"Include rebate-eligible insulation services"*

The app previews the resulting distribution automatically:
> total items → categories → work areas → items per category

---

### Stage C — Full Org Generation *(AI #2 — o3)*

The main generation step. o3 receives a rich context bundle and produces the entire catalog plus branch operating parameters in a single call.

**Context fed to the model:**

| Source | What's passed |
|---|---|
| GPT-4o extraction | `services[]`, `industry`, `region` |
| Website crawl | `companyName`, `about` (first 300 chars) |
| User input | `totalItems`, computed `workAreaCount`, `categoryCount`, `itemsPerCategory` |
| User input *(optional)* | `industryContext` freeform text |

---

**What o3 produces:**

#### Catalog

**Work Areas** — physical zones where work is performed
- e.g. Attic, Crawl Space, Exterior, Main Floor
- Each work area lists which item categories are relevant to it

**Categories** — service groupings, each with exactly N items:

| Field | Rule |
|---|---|
| `name` | Specific — includes method, grade, size, or condition |
| `title` | API display title; defaults to category name |
| `factorNames[]` | Factor relations resolved to IDs during deployment |
| `itemInfo` | ≤ 15 words, technical spec, written like a contractor invoice line |
| `notes` | 1–2 sentence customer-facing description: what's included and when/why it's needed |
| `unit` | `Sq. Ft.` for area work · `Linear Feet` for runs · `Each` for discrete jobs |
| `materialCost` | Wholesale cost to contractor (gets multiplied 1.4–2.2× for retail) |
| `laborHours` | Hours per unit for a 2–3 person experienced crew |
| `multiplierOverride` | Optional item-level price multiplier |
| `requiresInfo` | Whether the estimator must enter item-specific details |
| `factorNames[]` / `additionalCostNames[]` | Resource relations resolved to API IDs during deployment |

Unit assignment rules enforced:
- Insulation coverage, encapsulation, air sealing, coatings → **`Sq. Ft.`**
- Duct runs, pipe, wire, trim → **`Linear Feet`**
- Equipment installs, cleanings per unit, inspections → **`Each`**
- At least 30% of items must use `Sq. Ft.` or `Linear Feet` for insulation/HVAC companies

**Factors** — labor/material multipliers for job conditions
- Always includes `Standard` at 1.0 (always enabled)
- Additional factors: 1.1–1.6 for access difficulty, contamination, rush, stories, etc.

**Additional Costs** — permit fees, disposal, equipment rental, etc.

**Subcontracted Items** — outsourced work with material cost only (labor = 0)

**Vehicle Templates** — fleet vehicles (make, model, type, year)

**Equipment Types** — from: `cellulose_blower`, `fiberglass_blower`, `insulation_vacuum`, `ladder`, `safety`, `other`

---

#### Branch Operating Parameters

o3 generates realistic financial config for this specific industry and region:

| Parameter | Description |
|---|---|
| `baseHourlyRate` | Fully-loaded labor rate per tech-hour |
| `wasteFactor` | Material waste multiplier (e.g. 1.08) |
| `minRetailPrice` | Minimum job charge before any discounts |
| `maxDiscount` | Max % a salesperson can discount |
| `depositPercent` | % deposit required to book |
| `maxDepositAmount` | Dollar cap on deposit |
| `creditCardFee` | Processor rate (e.g. 0.03) |
| `gasCost` | Local pump price per gallon |
| `truckAverageMPG` | MPG for service vehicle fleet |
| `laborHoursLoadUnload` | Load/unload time per job |
| `subMultiplier` | Subcontractor cost multiplier |
| `cashFactor` | Cash payment discount factor |
| `bonusPoolPercentage` | % of revenue to crew bonus pool |
| `bonusPayoutCutoff` | Performance score cutoff for bonus |
| `financeFactors_3/6/12` | Finance markup factors per term length |

---

### Step 4 — Role Distribution *(User Input)*

User sets how many users to seed per role:
- Admin, Ops Manager, Sales Admin, Sales Member, Client Coordinator, Crew Leader, Crew Member

These become the initial user accounts for the org.

---

### Stage D — Serialization *(No AI)*

All sources are merged into a clean org JSON:

| Section | Source |
|---|---|
| Branch financial config | AI-generated (`branchConfig`) with sensible defaults as fallback |
| Branch text fields | Website crawl (about, disclaimer, payment terms, insurance claims, T&C) |
| Financing terms | Website crawl, or one default (0% for 12 months) |
| Payment methods | Fixed defaults (Financing, Cash, Credit Card, Check) |
| Catalog | Directly from o3 output |
| Users | Built from role distribution with standard email/password patterns |
| Multiplier ranges | Fixed defaults (5 ranges from $0 to $50k+) |

Org is saved to `server/src/generated-orgs/{slug}.json` with status `draft`.

---

### Step 5 — Result

Wizard shows a summary: branches, categories, work areas, user counts. Redirects to the Org Detail page.

---

### Stage E — Deployment *(No AI)*

User opens the Deploy panel, provides:
- attic-tech API base URL
- Credentials for an admin account scoped to exactly one existing organization
- Optional Supabase connection settings when the target uses a different Supabase project

Before deployment, a read-only preflight authenticates server-side, resolves the one accessible organization, and shows the records that will be created, updated, or left untouched. The user must type the exact organization confirmation string before writes are enabled. Credentials and tokens are never saved.

The deployment service performs name-based, idempotent upserts to Payload collections under `/api`, resolving relation IDs as it goes:

1. Upsert `/api/factors`, `/api/additional-costs`, `/api/multiplier-ranges` with the authenticated `organization`
2. Upsert `/api/items` with Payload relations `factors`, `additional_costs`, and `organization`
3. Upsert `/api/item-categories` with `items`, `factors`, and `organization`
4. Upsert `/api/work-areas` with `item_categories`, `factors`, and `organization`
5. Upsert `/api/branches` with `organization`
6. `PATCH /api/branch-configurations/:id` with nested `baseConstants`, `multiplier_ranges`, and `work_areas`
7. Upsert `/api/branch-financing-terms` and `/api/branch-payment-methods` with `branchConfiguration` and `organization`

Each step streams a live log entry: `running → done` or `failed`.

The deployer never creates or deletes organizations. Generated users, vehicle templates, equipment type suggestions, and item images remain deferred because their live collections require additional role, branch, type, or media resolution.

---

## What the AI Generates

*(additions since original flow)*

| Item | Where |
|---|---|
| `notes` per item | o3 · customer-facing 1–2 sentence description per item |
| `disclaimer` | o3 · industry-specific estimate disclaimer |
| `paymentTerms` | o3 · deposit + balance-due policy |
| `insuranceClaims` | o3 · customer insurance responsibility |
| `termsAndConditions` | o3 · scope authorization + warranty note |
| `defaultProposalEmailSubject` | o3 · email subject line with `{{companyName}}` placeholder |
| `defaultProposalEmailBody` | o3 · warm proposal email with `{{clientFirstName}}`, `{{proposalLink}}` |

---

## What the AI Does NOT Generate (Yet)

| Item | Notes |
|---|---|
| Logo | Still manual or via the enrichment tool |
| Item images | Via the enrichment tool after deployment |
| Invoice automation config | Hardcoded defaults |
| Demo job data | Not generated (clients, properties, jobs) |
| `autoSendDepositInvoice` | Always `false` |
