/** Whether `err` is Postgres's unique violation of `constraint`; drizzle may wrap it as `cause`. */
export const isUniqueViolation = (err: unknown, constraint: string): boolean => {
  const e = err as { code?: unknown; constraint?: unknown; cause?: unknown } | null;
  const pg = (e?.code ? e : e?.cause) as { code?: unknown; constraint?: unknown } | undefined;
  return pg?.code === "23505" && pg?.constraint === constraint;
};
