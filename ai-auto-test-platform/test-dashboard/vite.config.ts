import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_PROXY ?? "http://localhost:3001";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 8036,
      host: true,
      proxy: {
        "/api": apiTarget,
        "/health": apiTarget,
        "/ws": { target: apiTarget.replace(/^http/, "ws"), ws: true },
      },
    },
  };
});
