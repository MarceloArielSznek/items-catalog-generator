# Attic Projects — Catalog Image Generator

Internal tool that generates professional catalog-style product images by composing a background scene, a product item, and a company logo into a polished marketing visual.

Built for attic and crawl space service proposals, contracts, and sales materials.

## How It Works

1. **Create a Scene** — Upload a background image and company logo, set the logo position, and give it a name.
2. **Generate** — Select a saved scene, upload a product image, choose a generation mode and output format, and hit generate.
3. **Bulk Generate** — Drop multiple product images at once and process them all against the same scene. Download individually or as a ZIP.

## Generation Modes

| Mode | Speed | Cost | How it works |
|------|-------|------|--------------|
| **Quick** | ~5–15 sec | Free | Local background removal + programmatic composition with shadows using Sharp. No AI. |
| **Standard** | ~20–30 sec | ~$0.03–0.05 | Local background removal + AI refinement with `gpt-image-1-mini`. |
| **Premium** | ~45–60 sec | ~$0.20–0.30 | Full AI composition with `gpt-image-1`. Best visual realism. |

## Output Formats

| Format | Size | Use case |
|--------|------|----------|
| Square 1:1 | 1080×1080 | Instagram, social media |
| Landscape 16:9 | 1920×1080 | Presentations, websites |
| Portrait 4:5 | 1080×1350 | Instagram portrait |
| Story 9:16 | 1080×1920 | Stories, Reels, TikTok |
| Banner 2:1 | 1600×800 | Website headers |

## Tech Stack

**Frontend:** React 19, Vite, React Router  
**Backend:** Node.js, Express, Sharp, Multer  
**AI:** OpenAI `gpt-image-1` / `gpt-image-1-mini` (optional — Quick mode works without it)  
**Background Removal:** `@imgly/background-removal-node` (runs locally, no API costs)

## Setup

### Prerequisites

- Node.js 18+
- npm
- OpenAI API key (only needed for Standard/Premium modes)

### Install

```bash
# Install root dependencies
npm install

# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
```

### Configure

Copy the example environment file and add your API key:

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```
OPENAI_API_KEY=sk-your-key-here
PORT=3001
MAX_FILE_SIZE_MB=10
UPLOAD_DIR=src/uploads
GENERATED_DIR=src/generated
```

The `OPENAI_API_KEY` is optional. Without it, only Quick mode is available.

### Run

From the project root:

```bash
npm run dev
```

This starts both the backend (Express on port 3001) and the frontend (Vite on port 5173) concurrently.

Open `http://localhost:5173` in your browser.

## Project Structure

```
├── client/                  # React frontend
│   └── src/
│       ├── components/      # UploadField, ModeSelector, FormatSelector, BulkUploadZone, etc.
│       ├── pages/           # SceneManagerPage, GeneratorPage
│       ├── hooks/           # useCatalogComposer
│       ├── services/        # API client (scenes, generate, ZIP download)
│       └── styles/          # Global CSS
├── server/                  # Express backend
│   └── src/
│       ├── config/          # Environment variables
│       ├── controllers/     # Request orchestration
│       ├── middleware/       # Upload, validation, error handling
│       ├── routes/          # API route definitions
│       ├── services/        # Scene persistence, composition, background removal, OpenAI
│       └── utils/           # Logger, file validation, prompt builder
└── shared/
    └── constants/           # Image rules, modes, formats (shared between client and server)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/scenes` | List all scenes |
| `POST` | `/api/scenes` | Create a scene (background + logo) |
| `GET` | `/api/scenes/:id` | Get scene details |
| `DELETE` | `/api/scenes/:id` | Delete a scene |
| `POST` | `/api/generate-with-scene/:sceneId` | Generate image using a saved scene + uploaded item |
| `POST` | `/api/generate-catalog-image` | Generate image with all files uploaded (legacy) |
| `POST` | `/api/download-zip` | Download multiple generated images as ZIP |

## License

Internal tool — not for public distribution.
