import "varlock/auto-load";
import { faker } from "@faker-js/faker";
import { pool } from "../src/db/client.js";
import { logger } from "../src/lib/logger.js";
import { createEvent } from "../src/services/events/events.service.js";
import { generateFakeEvent } from "./fake-events-generator.js";

const SEED = 42;
const DEFAULT_COUNT = 50;

const main = async () => {
  const count = Number.parseInt(process.argv[2] ?? String(DEFAULT_COUNT), 10);
  if (!Number.isFinite(count) || count <= 0) {
    logger.error({ arg: process.argv[2] }, "Usage: pnpm db:seed [count]");
    process.exit(1);
  }
  faker.seed(SEED);
  logger.info({ count }, "Seeding demo events");
  for (let i = 0; i < count; i += 1) {
    await createEvent(generateFakeEvent("seed"));
  }
  logger.info("Seed complete");
};

main()
  .then(() => pool.end())
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exit(1);
  });
