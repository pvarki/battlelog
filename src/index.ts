import "varlock/auto-load";
import { serve } from "@hono/node-server";
import { ENV } from "varlock/env";
import { createApp } from "./app.ts";
import { runMigrations } from "./db/migrate.ts";
import { logger } from "./lib/logger.ts";
import { startEventsListener } from "./services/events/events.listener.ts";

const main = async () => {
  await runMigrations();
  const stopListener = startEventsListener();

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: ENV.PORT }, ({ port }) => {
    logger.info({ port }, "Server listening");
  });

  // Stop the listener before exiting so container stops don't log spurious
  // reconnect errors. SSE clients recover via Last-Event-ID replay.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    server.close();
    await stopListener();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
