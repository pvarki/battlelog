import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react({ babel: { plugins: ["babel-plugin-react-compiler"] } })],
  server: {
    // Spike: let tailscale serve proxy the dev server to phones on the tailnet.
    // IPv4 loopback explicitly — tailscaled proxies to 127.0.0.1, and Vite's
    // default "localhost" bind can land on [::1] only.
    host: "127.0.0.1",
    allowedHosts: [".ts.net"],
    // Dev: vite serves the SPA, the Hono server owns /api (incl. SSE).
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
