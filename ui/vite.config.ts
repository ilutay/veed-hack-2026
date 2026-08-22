import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The browser must not reach codex directly; the bridge holds that path.
  // Proxying server-side also means remote access needs ONE tunnel (5173),
  // never a second one to the bridge.
  //
  // /media is the bridge's rendered-lesson route. Without it the LessonVideo
  // player resolves the mp4 against the Vite origin and 404s once a render
  // lands, which looks like a broken render rather than a missing proxy.
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/media": "http://127.0.0.1:8787",
    },
  },
  preview: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/media": "http://127.0.0.1:8787",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
