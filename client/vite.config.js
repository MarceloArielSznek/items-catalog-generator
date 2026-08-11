import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, "../server");
  const env = loadEnv(mode, envDir, "");
  const port = env.PORT || "3005";
  const target = `http://localhost:${port}`;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Bind to 0.0.0.0 so the dev UI is reachable from other devices on the LAN
      // (e.g. http://<your-mac-ip>:5173). The /api proxy target stays localhost —
      // it resolves on this machine, so backend access works for LAN clients too.
      host: true,
      proxy: {
        "/api": target,
        "/generated": target,
        "/scenes": target,
        "/pre-generated": target,
      },
    },
  };
});
