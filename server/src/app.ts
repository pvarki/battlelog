import "varlock/auto-load";
import { serveStatic } from "@hono/node-server/serve-static";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { pinoLogger } from "hono-pino";
import { ENV } from "varlock/env";
import pkg from "../package.json" with { type: "json" };
import { logger } from "./lib/logger.ts";
import { eventRoutes } from "./routes/events/events.routes.ts";
import { rmRoutes } from "./routes/rmapi/rmapi.routes.ts";

const joinBase = (path: string) => {
  const base = ENV.BASE_URL.replace(/\/$/, "");
  return `${base}${path}`;
};

export const createApp = () => {
  const app = new OpenAPIHono();

  app.onError((err, c) => {
    logger.error({ err }, "unhandled error");
    return c.json({ error: "Internal server error" }, 500);
  });

  app.use("*", pinoLogger({ pino: logger }));
  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["*"],
    }),
  );

  // serveStatic root is cwd-relative. Container WORKDIR is /usr/src/app, so './uploads' resolves to /usr/src/app/uploads.
  app.use(
    "/uploads/*",
    serveStatic({ root: "./uploads", rewriteRequestPath: (p) => p.replace(/^\/uploads\//, "/") }),
  );

  app.get("/healthz", (c) => c.json({ ok: true }));

  for (const versioned of ["/api", "/api/v1"]) {
    const base = joinBase(versioned);
    app.route(base, eventRoutes);
  }

  if (ENV.RM_API_ENABLED) {
    app.route(joinBase("/rmapi"), rmRoutes);
  }

  if (ENV.USE_SWAGGER) {
    const openapiPath = joinBase("/openapi.json");
    app.doc(openapiPath, {
      openapi: "3.1.0",
      info: { title: "BattleLog API", version: pkg.version },
    });
    app.get(joinBase("/api-docs"), swaggerUI({ url: openapiPath }));
  }

  // SPA build output (web/dist, cwd-relative to server/). Mounted last so it
  // only serves what no API route matched; unmatched paths fall back to
  // index.html for client-side routing.
  app.use("*", serveStatic({ root: "../web/dist" }));
  app.get("*", serveStatic({ path: "../web/dist/index.html" }));

  return app;
};
