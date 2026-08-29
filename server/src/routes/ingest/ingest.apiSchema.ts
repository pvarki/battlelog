import { z } from "@hono/zod-openapi";
import type { IngestSourceRow } from "../../db/schema.ts";
import { getMatrixBotUserId, getStatus, transportKey } from "../../services/ingest/ingest.state.ts";
import type { IngestKind, IngestStatus } from "../../services/ingest/ingest.types.ts";

/**
 * A list of regular expressions. Validated here so an unparseable pattern is a
 * 400 at save time rather than a filter that silently matches nothing on the
 * stream. Length is capped: these run per CoT event, and an operator has no
 * reason to paste a novel.
 */
const patternList = z
  .array(
    z
      .string()
      .min(1)
      .max(200)
      .refine(
        (pattern) => {
          try {
            new RegExp(pattern);
            return true;
          } catch {
            return false;
          }
        },
        { message: "Not a valid regular expression" },
      ),
  )
  .max(50);

/**
 * One TAK setup's search. Every field is a list of unanchored regular
 * expressions; an omitted or empty list means no constraint on that field, so a
 * setup with nothing set takes everything — which the settings page says out
 * loud. All the constraints that are set must hold.
 */
export const takSourceConfigSchema = z
  .object({
    /** CoT `type`, e.g. "^a-f-" for friendly tracks. */
    cotTypes: patternList.optional(),
    /** GeoChat room, e.g. "^RECON$". This is "a feed of our choosing". */
    chatRooms: patternList.optional(),
    destCallsigns: patternList.optional(),
    senderCallsigns: patternList.optional(),
    /**
     * CoT `how`: "h-*" is human-entered, "m-*" machine-derived. `^h-` is the one
     * filter that separates what someone chose to report from the automatic
     * self-reports every client emits every few seconds.
     */
    hows: patternList.optional(),
    /** <__group role="...">, e.g. "^HQ$" for traffic from that role. */
    roles: patternList.optional(),
    /**
     * Rejected even when everything else matches. The only way to say "all of
     * this feed EXCEPT the position spam": every other field can only widen, so
     * without this the flood can only be dropped by writing a pattern that
     * enumerates everything you do want.
     */
    excludeCotTypes: patternList.optional(),
    /**
     * Matched against the raw CoT <detail> XML. How to select on things TAK has
     * no server-side concept of, an ATAK client's role being the motivating
     * case — read a real event's detail to find what to match.
     */
    detailContains: patternList.optional(),
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
    status: z.enum(["disabled", "connecting", "connected", "error", "not-joined", "encrypted"]),
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
    /** The ingest bot's MXID — who to invite to an invite-only room. */
    matrixBotUserId: z.string().nullable(),
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

/**
 * Just enough to pick a setup by: id, kind and the operator's name for it.
 *
 * Separate from the full row on purpose. Anyone building a dashboard needs to
 * choose which setups a feed shows, but a setup's config says which TAK feeds
 * and Matrix rooms this deployment watches, which is not for everyone.
 */
export const ingestSourceNameSchema = z
  .object({
    id: z.string().uuid(),
    kind: ingestKindSchema,
    name: z.string(),
  })
  .openapi("IngestSourceName");

export const createMatrixRoomRequestSchema = z
  .object({ name: z.string().min(1).max(100) })
  .openapi("CreateMatrixRoomRequest");

export const errorResponseSchema = z.object({ error: z.string() }).openapi("ErrorResponse");

/**
 * The stored config, re-validated on the way out.
 *
 * The comment here used to claim this and the body did not do it — the jsonb
 * went straight through, so a row written before a schema change was served,
 * and trusted downstream, whatever it happened to contain. Now an unparseable
 * config is served as an empty object: the source shows up in the settings list
 * with its status, which is what an operator needs in order to fix it, and no
 * caller is handed a shape it cannot rely on.
 */
const readConfig = (row: IngestSourceRow): unknown => {
  const schema = row.kind === "tak" ? takSourceConfigSchema : matrixSourceConfigSchema;
  const parsed = schema.safeParse(row.config);
  return parsed.success ? parsed.data : {};
};

/**
 * The status to show for one source row.
 *
 * TAK has a single socket shared by every TAK source, so a per-source
 * connection status does not exist and nothing ever set one — which meant
 * getStatus(row.id) fell through to its default and every TAK source displayed
 * "Off" for ever, however healthy the stream was. What IS per-source is how
 * much has matched, and countEvent(source.id) does record that.
 *
 * So: connection state from the transport, counters from the row. Matrix keeps
 * its own per-source status, because there a source is a room and can
 * genuinely be not-joined or waiting for keys while another is fine.
 */
const sourceStatus = (row: IngestSourceRow): IngestStatus => {
  const own = getStatus(row.id);
  if (row.kind !== "tak") return own;
  const transport = getStatus(transportKey("tak"));
  return {
    ...transport,
    eventCount: own.eventCount,
    ...(own.lastEventAt ? { lastEventAt: own.lastEventAt } : {}),
  };
};

export const toApiIngestSource = (row: IngestSourceRow) => ({
  id: row.id,
  kind: row.kind as IngestKind,
  name: row.name,
  enabled: row.enabled,
  config: readConfig(row),
  status: sourceStatus(row) satisfies IngestStatus,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const toApiIngestSourceName = (row: IngestSourceRow) => ({
  id: row.id,
  kind: row.kind as IngestKind,
  name: row.name,
});

export const transportStatuses = () => ({
  tak: getStatus(transportKey("tak")),
  matrix: getStatus(transportKey("matrix")),
  matrixBotUserId: getMatrixBotUserId() ?? null,
});
