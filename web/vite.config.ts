import { existsSync, readFileSync } from "node:fs";
import https from "node:https";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Local stand-in for the future same-origin deployment, where TAK sits under a
 * path of BattleLog's origin: `/tak/*` (REST and the `/takproto/1` WebSocket)
 * goes to TAK with the client cert from `server/.env`. Dev only, never built.
 */
const takProxy = (tak: Record<string, string>): ProxyOptions => ({
  target: `https://${tak.TAK_HOST}:${tak.TAK_API_PORT || 8443}`,
  changeOrigin: true,
  ws: true,
  rewrite: (path) => path.replace(/^\/tak/, ""),
  agent: new https.Agent({
    cert: readFileSync(tak.TAK_CERT_PATH as string),
    key: readFileSync(tak.TAK_KEY_PATH as string),
    ca: [...tls.rootCertificates, readFileSync(tak.TAK_CA_PATH as string)],
    // Same trust rule as the server's client: the RM intermediate may be the anchor.
    allowPartialTrustChain: true,
  }),
  configure: (proxy) => {
    // TAK rejects foreign origins (no allowOrigins configured); behind the
    // future path routing the browser is same-origin, so drop it here too.
    // TAK authenticates by the cert alone; the JSESSIONID it sets on the
    // WebSocket upgrade, sent back on a racing REST call, gets that call a 403.
    const strip = (req: { removeHeader(name: string): void }) => {
      req.removeHeader("origin");
      req.removeHeader("cookie");
    };
    proxy.on("proxyReq", strip);
    proxy.on("proxyReqWs", strip);
    proxy.on("proxyRes", (res) => {
      delete res.headers["set-cookie"];
    });
  },
});

export default defineConfig(({ command, mode }) => {
  const tak = loadEnv(mode, fileURLToPath(new URL("../server", import.meta.url)), "TAK_");
  // Direct mode by default when developing against a TAK; TAK_SOURCE=battlelog
  // switches back to the server-side connection.
  const wantDirect =
    command === "serve" &&
    tak.TAK_ENABLED === "true" &&
    Boolean(tak.TAK_HOST) &&
    process.env.TAK_SOURCE !== "battlelog";
  // The server's schema defaults are container paths; locally they must be set in server/.env.
  const certsFound = [tak.TAK_CERT_PATH, tak.TAK_KEY_PATH, tak.TAK_CA_PATH].every(
    (path) => path && existsSync(path),
  );
  if (wantDirect && !certsFound) {
    console.warn(
      "TAK direct mode off: set TAK_CERT_PATH, TAK_KEY_PATH, TAK_CA_PATH in server/.env",
    );
  }
  const takDirect = wantDirect && certsFound;
  return {
    define: { "import.meta.env.VITE_TAK_DIRECT": JSON.stringify(takDirect) },
    resolve: {
      // The direct-to-TAK client reuses the server's CoT parser and state logic.
      alias: { "@server": fileURLToPath(new URL("../server/src", import.meta.url)) },
    },
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
          navigateFallbackDenylist: [/^\/(api|uploads|rmapi|healthz|openapi\.json)/],
        },
      }),
    ],
    server: {
      // Dev: vite serves the SPA, the Hono server owns /api (incl. SSE).
      proxy: {
        "/api": process.env.API_URL ?? "http://localhost:3000",
        ...(takDirect && { "/tak": takProxy(tak) }),
      },
    },
  };
});
