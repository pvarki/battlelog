import { pool } from "./client.ts";

/**
 * True when the local compose DB answers. Integration suites skip with a
 * warning when it's down — except in CI, where silent skips would let the
 * whole DB-backed suite pass vacuously, so we fail instead.
 */
export const checkDbUp = async (suite: string): Promise<boolean> => {
  const up = await pool.query("select 1").then(
    () => true,
    () => false,
  );
  if (!up) {
    if (process.env.CI)
      throw new Error(`${suite}: database required in CI (docker compose up -d db)`);
    console.warn(`${suite} skipped: database not reachable`);
  }
  return up;
};
