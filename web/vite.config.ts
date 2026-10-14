import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import tls from "node:tls";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Dev stand-in for the deployment, where the browser reaches TAK with the
 * user's own client certificate. Locally `/tak/*` (REST and the `/takproto/1`
 * WebSocket) is proxied to TAK_PROXY_TARGET with a test certificate. Never built.
 *
 * The proxy speaks as that certificate, so only this dev page may use it: any
 * other site could otherwise open the WebSocket (WebSockets skip CORS) or post
 * forms through localhost.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isOwnPage = (req: IncomingMessage) => {
  const { origin, host } = req.headers;
  const site = req.headers["sec-fetch-site"];
  // Vite's own Host check skips proxied WebSocket upgrades, so a DNS-rebound
  // page ("same-origin" on evil.example:5173) must be refused here.
  const onLoopback =
    URL.canParse(`http://${host}`) && LOOPBACK.has(new URL(`http://${host}`).hostname);
  const sameOrigin = origin ? URL.canParse(origin) && new URL(origin).host === host : true;
  return onLoopback && sameOrigin && (!site || site === "same-origin");
};

const takProxy = (env: Record<string, string>, cert: Buffer): ProxyOptions => ({
  // false = 404, for plain requests and WebSocket upgrades alike.
  bypass: (req) => (isOwnPage(req) ? undefined : false),
  target: env.TAK_PROXY_TARGET,
  changeOrigin: true,
  ws: true,
  rewrite: (path) => path.replace(/^\/tak/, ""),
  agent: new https.Agent({
    cert,
    key: readFileSync(env.TAK_KEY_PATH as string),
    ca: [...tls.rootCertificates, readFileSync(env.TAK_CA_PATH as string)],
    // PVARKI's RM intermediate may be the only anchor we have.
    allowPartialTrustChain: true,
  }),
  configure: (proxy) => {
    // TAK rejects foreign origins, and the JSESSIONID it sets on the WebSocket
    // upgrade gets a racing REST call a 403; it authenticates by cert alone.
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

const devTak = (mode: string) => {
  const env = loadEnv(mode, import.meta.dirname, "TAK_");
  const paths = [env.TAK_CERT_PATH, env.TAK_KEY_PATH, env.TAK_CA_PATH];
  if (!env.TAK_PROXY_TARGET) return undefined;
  if (!paths.every((p) => p && existsSync(p))) {
    console.warn(
      "TAK dev proxy off: set TAK_CERT_PATH, TAK_KEY_PATH and TAK_CA_PATH in web/.env.local",
    );
    return undefined;
  }
  const cert = readFileSync(env.TAK_CERT_PATH as string);
  // The callsign TAK will see: the test certificate's CN.
  const callsign = /CN=([^,\n]+)/.exec(new X509Certificate(cert).subject)?.[1] ?? "";
  return { proxy: takProxy(env, cert), callsign, publicUrl: env.TAK_PROXY_TARGET };
};

export default defineConfig(({ command, mode }) => {
  const tak = command === "serve" ? devTak(mode) : undefined;
  return {
    define: tak
      ? {
          "import.meta.env.VITE_TAK_URL": JSON.stringify("/tak"),
          "import.meta.env.VITE_TAK_CALLSIGN": JSON.stringify(tak.callsign),
          "import.meta.env.VITE_TAK_PUBLIC_URL": JSON.stringify(tak.publicUrl),
        }
      : {},
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
          // The tactical graphics renderer (C5Ren, 7.4 MB) must work offline like the map.
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/(api|uploads|rmapi|healthz|openapi\.json)/],
          // Map tiles seen once stay available offline; "Save this area" fills the same cache.
          runtimeCaching: [
            {
              // MapLibre asks for every map image as image/*, whatever the URL looks like.
              urlPattern: ({ request }) =>
                request.destination === "image" ||
                !!request.headers.get("accept")?.startsWith("image/"),
              handler: "CacheFirst",
              options: {
                cacheName: "map-tiles",
                expiration: {
                  maxEntries: 20_000,
                  maxAgeSeconds: 60 * 60 * 24 * 60,
                  purgeOnQuotaError: true,
                },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
      }),
    ],
    // Pre-bundling moves the package into .vite/deps and breaks its
    // `new URL("./pkg/…wasm", import.meta.url)` lookup in dev.
    // MapLibre likewise loads its worker from a URL next to its own module.
    optimizeDeps: { exclude: ["@matrix-org/matrix-sdk-crypto-wasm", "maplibre-gl"] },
    server: {
      // Dev: vite serves the SPA, the Hono server owns /api (incl. SSE).
      proxy: {
        "/api": "http://localhost:3000",
        ...(tak && { "/tak": tak.proxy }),
      },
    },
  };
});
