import "varlock/auto-load";
import { serve } from "@hono/node-server";
import { ENV } from "varlock/env";
import { createApp } from "./app.ts";
import { runMigrations } from "./db/migrate.ts";
import { seedTemplates } from "./db/seed-templates.ts";
import { logger } from "./lib/logger.ts";
import { startEventsListener } from "./services/events/events.listener.ts";
import { startMatrixIngest } from "./services/matrix/matrix.ingest.ts";
import { startTakIngest } from "./services/tak/tak.stream.ts";

const main = async () => {
  await runMigrations();
  await seedTemplates();
  const stopListener = startEventsListener();
  // Both ingesters report their own state and never throw out here: TAK or
  // Synapse being down must not stop BattleLog from serving its own feed.
  const stopTakIngest = startTakIngest();
  const stopMatrixIngest = startMatrixIngest();

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
    await stopTakIngest();
    await stopMatrixIngest();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
