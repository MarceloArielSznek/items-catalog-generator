# Attic Projects — Org Generator

Internal tool for generating and deploying fully-configured **Menaia organizations** for home-service contractors (attic, crawl space, HVAC, etc.).

Given a company website URL (or a pricebook spreadsheet), the tool crawls the site, builds a complete org — service categories, items, pricing factors, work areas, branch config — and deploys it directly into a Menaia/Attic-Tech instance.

---

## What It Does

### 1. Org Generator (AI-powered)
- Crawl a company website to extract services, branding, and pricing signals
- Generate a full pricebook with categories, items, descriptions, and base prices
- Review and edit every detail before deploying
- Alternatively, upload a `.xlsx` pricebook to bootstrap from existing data

### 2. Org Detail & Catalog Editor
- Browse generated orgs with full category/item breakdown
- Edit items inline: name, description, price, notes
- Manage service images per item:
  - **Web search** — find ranked web candidates via Google/Serper
  - **AI generate** — create a photorealistic catalog photo with `gpt-image-1`
  - **AI edit (img2img)** — refine an existing image based on text feedback
  - **Upload** — use your own image
- Bulk image generation per category (AI or web, with SSE progress stream)

### 3. Org Settings
- Edit company info (name, industry, region, timezone, website)
- Configure branch-level defaults (financing terms, proposal copy)
- Set a visual image style (home, technician look, tone) — used as context for all AI-generated images
- AI-assisted style suggestion based on industry/region

### 4. Deployment
- Run a **preflight plan** to resolve the target Menaia organization before touching anything
- Deploy with one click: upserts categories, items, work areas, factors, and branch config
- Deployment log tracked per org

### 5. Item Enrichment (legacy / Payload CMS orgs)
- AI-powered batch enrichment for items loaded from a Payload CMS instance
- Generates descriptions, tags, and images; auto-enrich with select-all support

---

## Tech Stack

**Frontend:** React 19, Vite, React Router  
**Backend:** Node.js 22, Express, Sharp, Multer  
**AI:** OpenAI `gpt-image-1` / `gpt-4o-mini` · Anthropic Claude (vision scoring)  
**Image search:** Google Custom Search API · Serper.dev  
**Target platform:** Menaia / Attic-Tech API + Supabase auth

---

## Setup

### Prerequisites

- Node.js 18+
- npm
- OpenAI API key (required for org generation, AI images, and image-style suggestions)

### Install

```bash
# Root dependencies (concurrently, etc.)
npm install

# Server
cd server && npm install

# Client
cd ../client && npm install
```

### Configure

```bash
cp server/.env.example server/.env
```

Edit `server/.env` — at minimum set:

```
OPENAI_API_KEY=sk-…
MENAIA_API_URL=http://localhost:3000   # or your production URL
MENAIA_EMAIL=admin@my-org.com
MENAIA_PASSWORD=…
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=…
```

Image search keys (`GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX`, `SERPER_API_KEY`) are optional — only needed for the web-image-candidates feature.

### Run

```bash
npm run dev
```

Starts both the Express backend (port 3033 by default) and the Vite frontend (port 5173) concurrently.

Open `http://localhost:5173`.

---

## Project Structure

```
├── client/src/
│   ├── pages/
│   │   ├── OrgDashboardPage.jsx     # List of all generated orgs
│   │   ├── OrgGeneratorPage.jsx     # New org wizard (crawl / XLSX upload)
│   │   ├── OrgDetailPage.jsx        # Catalog editor — categories, items, images
│   │   ├── OrgSettingsPage.jsx      # Company info, branch config, image style
│   │   └── ItemsManagerPage.jsx     # Legacy Payload CMS item enrichment
│   ├── components/
│   │   ├── TrainingWizard.jsx       # Org generation step-by-step wizard
│   │   ├── TrainingInsights.jsx     # Research insights panel
│   │   └── EnrichWizard.jsx         # Item enrichment wizard
│   └── services/
│       ├── orgApi.js                # Org CRUD + deployment + image endpoints
│       └── seedApi.js               # Website crawl + pricebook generation
├── server/src/
│   ├── routes/
│   │   ├── orgRoutes.js             # /api/orgs — CRUD, deploy, item images
│   │   ├── seedRoutes.js            # /api/seed — crawl, extract, generate
│   │   └── enrichmentRoutes.js      # /api/enrich — Payload CMS enrichment
│   ├── services/
│   │   ├── orgStorageService.js     # JSON file storage for orgs
│   │   ├── deploymentService.js     # Menaia API deployment logic
│   │   ├── imageSearchService.js    # Google/Serper image search + scoring
│   │   ├── seedGenerator/           # Crawl → extract → research → serialize
│   │   └── enrichmentService.js     # AI description + image enrichment
│   └── generated-orgs/             # Local org storage (gitignored)
└── shared/
    └── constants/                   # Shared config between client and server
```

---

## Key API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/orgs` | List all orgs |
| `POST` | `/api/orgs` | Save a generated org |
| `GET` | `/api/orgs/:slug` | Get full org JSON |
| `PATCH` | `/api/orgs/:slug` | Partial update |
| `PATCH` | `/api/orgs/:slug/settings` | Update org info / branch config / image style |
| `PATCH` | `/api/orgs/:slug/resources` | Update catalog categories, items, factors |
| `POST` | `/api/orgs/:slug/deploy/plan` | Preflight deployment plan |
| `POST` | `/api/orgs/:slug/deploy` | Execute deployment to Menaia |
| `POST` | `/api/orgs/:slug/resources/item-image/generate` | AI-generate image for one item |
| `POST` | `/api/orgs/:slug/resources/item-image/edit` | img2img edit with feedback |
| `POST` | `/api/orgs/:slug/resources/item-image/candidates` | Web image candidates |
| `POST` | `/api/orgs/:slug/resources/bulk-generate-images` | Bulk image generation (SSE) |
| `POST` | `/api/seed/crawl` | Crawl a website |
| `POST` | `/api/seed/generate` | Generate pricebook from crawl data |
| `POST` | `/api/seed/from-xlsx` | Bootstrap from spreadsheet |
| `GET` | `/api/health` | Health check |

---

## License

Internal tool — not for public distribution.
