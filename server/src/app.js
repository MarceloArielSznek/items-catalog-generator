import express from "express";
import cors from "cors";
import env from "./config/env.js";
import imageRoutes from "./routes/imageRoutes.js";
import sceneRoutes from "./routes/sceneRoutes.js";
import downloadRoutes from "./routes/downloadRoutes.js";
import libraryRoutes from "./routes/libraryRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(cors());
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

app.use(errorHandler);

export default app;
