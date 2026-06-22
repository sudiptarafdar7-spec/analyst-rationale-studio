import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api and /uploads to the FastAPI backend so the frontend
// can call the API and load uploaded files on the same origin during dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/uploads": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
