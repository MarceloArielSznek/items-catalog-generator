import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import env from "./config/env.js";
import { menaiaContextMiddleware } from "./config/menaiaContext.js";
import imageRoutes from "./routes/imageRoutes.js";
import sceneRoutes from "./routes/sceneRoutes.js";
import downloadRoutes from "./routes/downloadRoutes.js";
import libraryRoutes from "./routes/libraryRoutes.js";
import payloadRoutes from "./routes/payloadRoutes.js";
import enrichmentRoutes from "./routes/enrichmentRoutes.js";
import seedRoutes from "./routes/seedRoutes.js";
import orgRoutes from "./routes/orgRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

if (env.IS_PRODUCTION) {
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: ["https://catalog.yallaprojects.com"] }));

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests, please try again later" },
  });

  const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Upload limit reached, please try again later" },
  });

  app.use("/api", apiLimiter);
  app.use("/api/generate", uploadLimiter);
  app.use("/api/remove-background", uploadLimiter);
} else {
  app.use(cors());
}

app.use(express.json());

// Resolve per-request Menaia credentials (sent by the browser) for all routes.
app.use(menaiaContextMiddleware);

app.use("/generated", express.static(env.GENERATED_DIR));
app.use("/scenes", express.static(env.SCENES_DIR));
app.use("/pre-generated", express.static(path.resolve(__dirname, "pre-generated")));

// ── Org generator (always mounted — this is the product that ships) ──────────
app.use("/api/seed", seedRoutes);
app.use("/api/orgs", orgRoutes);

// ── Legacy item generator (compose / scenes / library / payload / enrich) ────
// Unmounted in production; kept for dev. Toggle via ENABLE_ITEM_GENERATOR.
if (env.ENABLE_ITEM_GENERATOR) {
  app.use("/api", imageRoutes);
  app.use("/api/scenes", sceneRoutes);
  app.use("/api", downloadRoutes);
  app.use("/api/library", libraryRoutes);
  app.use("/api/payload", payloadRoutes);
  app.use("/api/enrich", enrichmentRoutes);
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

if (env.IS_PRODUCTION) {
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use(errorHandler);

export default app;
