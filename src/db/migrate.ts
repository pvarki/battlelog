import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { logger } from "../lib/logger.js";
import { db, pool } from "./client.js";

export const runMigrations = async () => {
  logger.info("Ensuring PostGIS extension");
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);
  logger.info("Running migrations");
  await migrate(db, { migrationsFolder: "./drizzle" });
  logger.info("Migrations complete");
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, "Migration failed");
      process.exit(1);
    });
}
