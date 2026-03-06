import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, "../server");
  const env = loadEnv(mode, envDir, "");
  const port = env.PORT || "3001";
  const target = `http://localhost:${port}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": target,
        "/generated": target,
        "/scenes": target,
      },
    },
  };
});
