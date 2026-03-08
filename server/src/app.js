import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import env from "./config/env.js";
import imageRoutes from "./routes/imageRoutes.js";
import sceneRoutes from "./routes/sceneRoutes.js";
import downloadRoutes from "./routes/downloadRoutes.js";
import libraryRoutes from "./routes/libraryRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

const allowedOrigins = env.IS_PRODUCTION
  ? ["https://catalog.yallaprojects.com"]
  : ["http://localhost:5173"];

app.use(cors({ origin: allowedOrigins }));

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

app.use(express.json());

app.use("/generated", express.static(env.GENERATED_DIR));
app.use("/scenes", express.static(env.SCENES_DIR));

app.use("/api", imageRoutes);
app.use("/api/scenes", sceneRoutes);
app.use("/api", downloadRoutes);
app.use("/api/library", libraryRoutes);

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
