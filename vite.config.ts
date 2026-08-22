import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.join(root, "src") },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
