import "varlock/auto-load";
import { serveStatic } from "@hono/node-server/serve-static";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { pinoLogger } from "hono-pino";
import { ENV } from "varlock/env";
import { logger } from "./lib/logger.ts";
import { eventRoutes } from "./routes/events/events.routes.ts";

const joinBase = (path: string) => {
  const base = ENV.BASE_URL.replace(/\/$/, "");
  return `${base}${path}`;
};

export const createApp = () => {
  const app = new OpenAPIHono();

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

  if (ENV.USE_SWAGGER) {
    const openapiPath = joinBase("/openapi.json");
    app.doc(openapiPath, { openapi: "3.1.0", info: { title: "BattleLog API", version: "2.0.0" } });
    app.get(joinBase("/api-docs"), swaggerUI({ url: openapiPath }));
  }

  // SPA / frontend assets. Legacy: routes.use(express.static('./public')).
  // Mounted last so it only serves what no API route matched.
  app.use("*", serveStatic({ root: "./public" }));

  return app;
};
