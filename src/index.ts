import "varlock/auto-load";
import { serve } from "@hono/node-server";
import { ENV } from "varlock/env";
import { createApp } from "./app.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./lib/logger.js";

const main = async () => {
  await runMigrations();

  const app = createApp();
  serve({ fetch: app.fetch, port: ENV.PORT }, ({ port }) => {
    logger.info({ port }, "Server listening");
  });
};

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
