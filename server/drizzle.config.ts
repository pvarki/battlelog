import "varlock/auto-load";
import type { Config } from "drizzle-kit";
import { ENV } from "varlock/env";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: ENV.DATABASE_URL,
  },
} satisfies Config;
