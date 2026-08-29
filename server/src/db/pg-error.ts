/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

/**
 * Is this a unique-violation on a named constraint?
 *
 * Two constraints in this schema are load-bearing — a duplicate template name is
 * a 409, and a lost race on an event's `update_for` is a 409 — so the driver
 * error has to be readable rather than becoming a 500.
 *
 * The cause chain is walked because drizzle changed where the pg error lives:
 * up to 0.36 it was thrown directly, from 0.45 it is wrapped in a
 * `DrizzleQueryError` with the original on `cause`. Reading only the top level
 * silently turned both 409s into 500s on upgrade, which is the sort of thing
 * that shows up as an unexplained error in production long after the bump.
 */
export const isUniqueViolation = (err: unknown, constraint: string): boolean => {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const pg = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === UNIQUE_VIOLATION && pg.constraint === constraint) return true;
    e = pg.cause;
  }
  return false;
};
