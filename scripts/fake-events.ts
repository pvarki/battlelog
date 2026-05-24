import "varlock/auto-load";
import { pool } from "../src/db/client.js";
import { logger } from "../src/lib/logger.js";
import { createEvent } from "../src/services/events/events.service.js";
import { generateFakeEvent } from "./fake-events-generator.js";

const main = async () => {
  const count = Number.parseInt(process.argv[2] ?? "10", 10);
  if (!Number.isFinite(count) || count <= 0) {
    logger.error({ arg: process.argv[2] }, "Usage: pnpm db:fake [count]");
    process.exit(1);
  }
  logger.info({ count }, "Inserting fake events");
  for (let i = 0; i < count; i += 1) {
    await createEvent(generateFakeEvent());
  }
  logger.info({ count }, "Done");
};

main()
  .then(() => pool.end())
  .catch((err) => {
    logger.error({ err }, "fake-events script failed");
    process.exit(1);
  });
