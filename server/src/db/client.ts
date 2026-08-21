import "varlock/auto-load";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { ENV } from "varlock/env";
import * as schema from "./schema.ts";

export const pool = new pg.Pool({ connectionString: ENV.DATABASE_URL });
export const db = drizzle(pool, { schema });
