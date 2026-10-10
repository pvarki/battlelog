import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        id: "/",
        name: "BattleLog",
        short_name: "BattleLog",
        description: "Event log for situational awareness",
        start_url: "/",
        display: "standalone",
        background_color: "#111418",
        theme_color: "#111418",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Univer is lazy-loaded by the Table widget and is substantially
        // larger than Workbox's 2 MiB precache limit. Keeping it out of the
        // app-shell cache preserves the normal dashboard's fast first load.
        globIgnores: ["assets/univer-*.{js,css}"],
        navigateFallbackDenylist: [/^\/(api|uploads|rmapi|healthz|openapi\.json)/],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Keep all Univer internals in the lazy table-editor chunk. Otherwise
        // its optional locale modules are emitted as many small chunks and
        // accidentally become part of the PWA app-shell precache.
        manualChunks(id) {
          return id.includes("/node_modules/@univerjs/") ? "univer" : undefined;
        },
      },
    },
  },
  server: {
    // Dev: vite serves the SPA, the Hono server owns /api (incl. SSE).
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
