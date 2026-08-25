import { z } from "@hono/zod-openapi";
import type { IngestSourceRow } from "../../db/schema.ts";
import { getStatus, transportKey } from "../../services/ingest/ingest.state.ts";
import type { IngestKind, IngestStatus } from "../../services/ingest/ingest.types.ts";

const trimmedList = z.array(z.string().min(1).max(200)).max(50);

/**
 * A TAK source's config. Every field narrows what is taken off the CoT stream,
 * and an omitted or empty list means no constraint on that field — so a source
 * with nothing set takes everything, which the settings page says out loud.
 */
export const takSourceConfigSchema = z
  .object({
    /** CoT `type` prefixes, e.g. "a-f-" for friendly tracks. */
    cotTypes: trimmedList.optional(),
    /** GeoChat rooms, matched exactly. This is "a feed of our choosing". */
    chatRooms: trimmedList.optional(),
    destCallsigns: trimmedList.optional(),
    senderCallsigns: trimmedList.optional(),
    /**
     * Substrings that must appear in the raw CoT <detail> XML. How to select on
     * things TAK has no server-side concept of, an ATAK client's role being the
     * motivating case — find the exact string in an event's detail first.
     */
    detailContains: trimmedList.optional(),
  })
  .openapi("TakIngestConfig");

export const matrixSourceConfigSchema = z
  .object({
    /** Room ID, "!abc:domain" — what /sync keys rooms by. */
    roomId: z.string().min(1).max(255),
    /** Room name or alias, shown in the settings list. Display only. */
    roomName: z.string().max(255).optional(),
  })
  .openapi("MatrixIngestConfig");

const ingestKindSchema = z.enum(["tak", "matrix"]);

const ingestStatusSchema = z
  .object({
    status: z.enum(["disabled", "connecting", "connected", "error", "encrypted"]),
    lastError: z.string().optional(),
    lastEventAt: z.string().optional(),
    eventCount: z.number().int(),
  })
  .openapi("IngestStatus");

export const ingestSourceResponseSchema = z
  .object({
    id: z.string().uuid(),
    kind: ingestKindSchema,
    name: z.string(),
    enabled: z.boolean(),
    // z.any (not z.unknown): unknown fails Hono's JSONValue constraint and
    // collapses typed responses to never — same reason as widget config.
    config: z.any(),
    /** Live, from this process. Not stored: a status read back after a restart would be a lie. */
    status: ingestStatusSchema,
    createdBy: z.string(),
    updatedBy: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("IngestSource");

export const createIngestSourceRequestSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("tak"),
      name: z.string().min(1).max(100),
      enabled: z.boolean().default(true),
      config: takSourceConfigSchema.default({}),
    }),
    z.object({
      kind: z.literal("matrix"),
      name: z.string().min(1).max(100),
      enabled: z.boolean().default(true),
      config: matrixSourceConfigSchema,
    }),
  ])
  .openapi("CreateIngestSourceRequest");

/**
 * `kind` is immutable: it decides which shape `config` has, and changing it
 * would leave a TAK filter on a Matrix source. Delete and re-add instead.
 */
export const updateIngestSourceRequestSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    config: z.union([takSourceConfigSchema, matrixSourceConfigSchema]).optional(),
  })
  .openapi("UpdateIngestSourceRequest");

export const transportStatusResponseSchema = z
  .object({
    tak: ingestStatusSchema,
    matrix: ingestStatusSchema,
  })
  .openapi("IngestTransportStatus");

export const matrixRoomResponseSchema = z
  .object({
    roomId: z.string(),
    name: z.string().optional(),
    alias: z.string().optional(),
    isSpace: z.boolean(),
  })
  .openapi("MatrixRoom");

export const errorResponseSchema = z.object({ error: z.string() }).openapi("ErrorResponse");

/** Config still has to be re-checked here: rows predate any later schema change. */
export const toApiIngestSource = (row: IngestSourceRow) => ({
  id: row.id,
  kind: row.kind as IngestKind,
  name: row.name,
  enabled: row.enabled,
  config: row.config,
  status: getStatus(row.id) satisfies IngestStatus,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const transportStatuses = () => ({
  tak: getStatus(transportKey("tak")),
  matrix: getStatus(transportKey("matrix")),
});
