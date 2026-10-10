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
        // Chat needs the network anyway; don't make every install download the Matrix SDK.
        globIgnores: ["**/matrix-*.js"],
        navigateFallbackDenylist: [/^\/(api|uploads|rmapi|healthz|openapi\.json)/],
      },
    }),
  ],
  // Pre-bundling moves the package into .vite/deps and breaks its
  // `new URL("./pkg/…wasm", import.meta.url)` lookup in dev.
  optimizeDeps: { exclude: ["@matrix-org/matrix-sdk-crypto-wasm"] },
  server: {
    // Dev: vite serves the SPA, the Hono server owns /api (incl. SSE).
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
