import { and, asc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "../../db/client.ts";
import {
  type IngestCursorRow,
  type IngestSourceInsert,
  type IngestSourceRow,
  ingestCursors,
  ingestSources,
} from "../../db/schema.ts";
import type { IngestKind } from "./ingest.types.ts";

export type CreateIngestSourceInput = Omit<
  IngestSourceInsert,
  "id" | "createdAt" | "updatedAt" | "updatedBy"
>;

export type UpdateIngestSourcePatch = Partial<
  Pick<IngestSourceInsert, "name" | "enabled" | "config">
>;

/** Thrown when the id is well-formed but no such source exists. */
export class IngestSourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Ingest source ${id} not found`);
    this.name = "IngestSourceNotFoundError";
  }
}

export const listIngestSources = async (): Promise<IngestSourceRow[]> =>
  db.select().from(ingestSources).orderBy(asc(ingestSources.kind), asc(ingestSources.name));

export const createIngestSource = async (
  input: CreateIngestSourceInput,
): Promise<IngestSourceRow> => {
  const [row] = await db
    .insert(ingestSources)
    .values({ ...input, id: uuidv7() })
    .returning();
  if (!row) throw new Error("createIngestSource: insert returned no row");
  return row;
};

export const updateIngestSource = async (
  id: string,
  patch: UpdateIngestSourcePatch,
  updatedBy: string,
): Promise<IngestSourceRow> => {
  const [row] = await db
    .update(ingestSources)
    .set({ ...patch, updatedBy, updatedAt: new Date() })
    .where(eq(ingestSources.id, id))
    .returning();
  if (!row) throw new IngestSourceNotFoundError(id);
  return row;
};

export const deleteIngestSource = async (id: string): Promise<void> => {
  const deleted = await db.delete(ingestSources).where(eq(ingestSources.id, id)).returning();
  if (!deleted.length) throw new IngestSourceNotFoundError(id);
};

/**
 * Enabled sources of one kind, cached briefly.
 *
 * The cache is what lets the ingesters re-read selection on every cycle instead
 * of at boot, so an admin's change takes effect without a restart. The TTL is
 * the worst-case delay for that, and also the reason the TAK stream can consult
 * this per CoT event without hammering the DB.
 */
const CACHE_TTL_MS = 5_000;

const cache = new Map<IngestKind, { at: number; rows: IngestSourceRow[] }>();

export const enabledIngestSources = async (kind: IngestKind): Promise<IngestSourceRow[]> => {
  const hit = cache.get(kind);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.rows;
  const rows = await db
    .select()
    .from(ingestSources)
    .where(and(eq(ingestSources.kind, kind), eq(ingestSources.enabled, true)));
  cache.set(kind, { at: now, rows });
  return rows;
};

/** Drop the cache so a just-saved change is picked up on the next cycle, not in 5s. */
export const invalidateIngestSourceCache = (): void => cache.clear();

export const getIngestCursor = async (source: string): Promise<string | undefined> => {
  const [row] = await db.select().from(ingestCursors).where(eq(ingestCursors.source, source));
  return (row as IngestCursorRow | undefined)?.cursor;
};

export const setIngestCursor = async (source: string, cursor: string): Promise<void> => {
  await db
    .insert(ingestCursors)
    .values({ source, cursor })
    .onConflictDoUpdate({
      target: ingestCursors.source,
      set: { cursor, updatedAt: new Date() },
    });
};
