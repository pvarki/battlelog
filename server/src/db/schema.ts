import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  geometry,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const admiraltyReliabilityEnum = pgEnum("admiralty_reliability", [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
]);

export const admiraltyCredibilityEnum = pgEnum("admiralty_credibility", [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
]);

export const events = pgTable(
  "events",
  {
    /** Row identifier — unique per version. Use {@link eventId} for the logical event across its history. */
    id: uuid("id").primaryKey(),
    /**
     * Logical event identifier — stable across the event's full version history.
     * Equals {@link id} on the root row; inherited unchanged on every update.
     */
    eventId: uuid("event_id").notNull(),
    /**
     * Pointer to the previous version's {@link id}. `null` on the root row.
     * Unique — each version can be superseded at most once (linear history,
     * concurrent updates fail with a constraint violation).
     */
    updateFor: uuid("update_for").unique(),

    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    eventTime: timestamp("event_time", { withTimezone: true }),

    header: text("header").notNull(),

    /** General-purpose tags for events; used for filtering. */
    tags: text("tags").array(),

    /**
     * Domains of hybrid threats per the European Centre of Excellence for Countering
     * Hybrid Threats (Hybrid CoE, Helsinki) taxonomy — e.g. information, cyber,
     * military, economy, infrastructure, political, social, legal, intelligence,
     * diplomacy, administration, culture, space.
     * TODO: confirm Hybrid CoE (vs. NATO HUMINT CoE) is the intended source, and
     * pin down the exact controlled vocabulary used in this column.
     */
    hcoeDomains: text("hcoe_domains").array(),
    /**
     * Source reliability per NATO AJP-2.1 / STANAG 2511 (the "Admiralty Code"):
     * - `A` completely reliable
     * - `B` usually reliable
     * - `C` fairly reliable
     * - `D` not usually reliable
     * - `E` unreliable
     * - `F` reliability cannot be judged
     */
    admiraltyReliability: admiraltyReliabilityEnum("admiralty_reliability"),
    /**
     * Information credibility per NATO AJP-2.1 / STANAG 2511 (the "Admiralty Code").
     * NATO calls this "credibility"; column kept as `accuracy` for legacy reasons.
     * - `1` confirmed by other sources
     * - `2` probably true
     * - `3` possibly true
     * - `4` doubtful
     * - `5` improbable
     * - `6` truth cannot be judged
     */
    admiraltyAccuracy: admiraltyCredibilityEnum("admiralty_accuracy"),

    /** Free-text place name / description (not coordinates). */
    location: text("location"),
    /**
     * Coordinates as a PostGIS point in WGS84 (SRID 4326). Drizzle reads/writes
     * as `[lng, lat]` tuples; the API layer is responsible for `{ lat, lng }`
     * shape conversion at the boundary. Indexed with GiST for spatial queries.
     */
    locationPoint: geometry("location_point", {
      type: "point",
      mode: "tuple",
      srid: 4326,
    }),

    /** Input method / ingestion source for the event (e.g. "battlelog-api"). Future sink integrations will populate this. */
    inputSource: text("input_source"),
    /**
     * The ingest setup that produced this event, when it came from one. This is
     * what lets a dashboard show "the events from these setups" — a setup is
     * named by its operator, so the picker shows names and stores ids.
     *
     * Deliberately not a foreign key: deleting a setup must not delete history
     * or block on it. A dangling id just stops resolving to a name.
     */
    ingestSourceId: uuid("ingest_source_id"),
    /** URI back to the originating source (e.g. upstream feed URL, file ref). */
    sourceUri: text("source_uri"),

    /** Discriminator for {@link data}; also names the type definition for the whole event, so clients can expect specific fields. */
    type: text("type"),
    /** payload whose shape depends on {@link type}. */
    data: jsonb("data"),
  },
  (t) => ({
    idEventIdUnique: unique("events_id_event_id_unique").on(t.id, t.eventId),
    chainFk: foreignKey({
      columns: [t.updateFor, t.eventId],
      foreignColumns: [t.id, t.eventId],
      name: "events_chain_fk",
    }),
    rootCheck: check(
      "events_root_check",
      sql`${t.updateFor} IS NOT NULL OR ${t.eventId} = ${t.id}`,
    ),
    eventIdIdx: index("events_event_id_idx").on(t.eventId),
    eventTimeIdx: index("events_event_time_idx").on(t.eventTime),
    createdAtIdx: index("events_created_at_idx").on(t.createdAt),
    tagsIdx: index("events_tags_gin_idx").using("gin", t.tags),
    hcoeDomainsIdx: index("events_hcoe_domains_gin_idx").using("gin", t.hcoeDomains),
    typeIdx: index("events_type_idx").on(t.type),
    ingestSourceIdx: index("events_ingest_source_idx").on(t.ingestSourceId),
    createdByIdx: index("events_created_by_idx").on(t.createdBy),
    /**
     * One original row per upstream message, so re-ingesting is a no-op.
     *
     * Both ingesters build a stable sourceUri, and both upstreams repeat
     * themselves: TAK re-sends the same uid on a timer, and a crash between
     * createEvent and the Matrix cursor write replays the batch. For a log
     * meant to be an evidentiary record, duplicate entries are a correctness
     * bug, not noise.
     *
     * Partial on `update_for IS NULL` and that is load-bearing: updateEvent
     * inserts a new version as `{...head, ...patch}`, which copies sourceUri,
     * so an unconditional unique index would make every ingested event
     * uneditable. NULL sourceUri is excluded too — human entries have none and
     * are not deduplicated.
     */
    sourceUriIdx: uniqueIndex("events_source_uri_original_uidx")
      .on(t.sourceUri)
      .where(sql`${t.updateFor} IS NULL AND ${t.sourceUri} IS NOT NULL`),
    locationPointIdx: index("events_location_point_gix").using("gist", t.locationPoint),
  }),
);

export type EventRow = typeof events.$inferSelect;
export type EventInsert = typeof events.$inferInsert;

/**
 * A widget instance on a dashboard: grid placement plus a type discriminator
 * and per-widget config. `type` and `config` are opaque to the server — the
 * web app's widget registry owns them and validates config on read, so new
 * widget types need no server deploy. The API validates structure only.
 */
export type DashboardWidget = {
  id: string;
  type: string;
  /** Optional to match zod's z.any() inference; the UI treats absent as {}. */
  config?: unknown;
  layout: { x: number; y: number; w: number; h: number };
};

/** User-composable dashboards: a named grid of widgets. */
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    /** One line on what this board is for — the list shows it to tell near-identical names apart. */
    description: text("description"),
    /** Templates are dashboards on a shelf: instantiating copies name+widgets. */
    isTemplate: boolean("is_template").notNull().default(false),
    widgets: jsonb("widgets").$type<DashboardWidget[]>().notNull().default([]),
    /** Optimistic concurrency token: rewritten on every update; stale writers get 409. */
    version: text("version").notNull().default("0"),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // Template names are the seeding upsert key — enforce at the DB so
    // concurrent boots can't double-seed (check-then-insert races otherwise).
    templateNameUnique: uniqueIndex("dashboards_template_name_unique")
      .on(t.name)
      .where(sql`${t.isTemplate}`),
  }),
);

export type DashboardRow = typeof dashboards.$inferSelect;
export type DashboardInsert = typeof dashboards.$inferInsert;

/**
 * Users, as RASENMAEHER tells us about them. We store them for exactly one
 * reason: `isAdmin`, which gates who may change what gets ingested. RM is the
 * source of truth, so every field here is written by the /rmapi user hooks and
 * never by the app itself.
 */
export const users = pgTable("users", {
  /** RM's person primary key, sent as `uuid` in the user CRUD payload. */
  uuid: text("uuid").primaryKey(),
  /**
   * Not unique: RM can hand the same callsign to a new person after the old one
   * is revoked, and a unique constraint made that a 500 on the /rmapi hook —
   * which RM reads as a provisioning failure. {@link findUserByCn} prefers the
   * live row instead.
   */
  callsign: text("callsign").notNull(),
  /**
   * CN of the user's client certificate, when it differs from the callsign.
   * `createdBy` and the admin gate both work off the CN in the mTLS DN header,
   * so this is what maps an incoming request back to an RM user.
   */
  certCn: text("cert_cn"),
  isAdmin: boolean("is_admin").notNull().default(false),
  /** Set when RM revokes the user's cert. Rows are kept: events still reference them. */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;

export const ingestKindEnum = pgEnum("ingest_kind", ["tak", "matrix"]);

/**
 * One row per thing being ingested into the feed. This is the selection surface:
 * an admin adds, edits and disables these at runtime, and the ingesters re-read
 * them on every cycle rather than at boot.
 *
 * `config` is opaque here and validated per kind at the API boundary
 * (routes/ingest/ingest.apiSchema.ts), the same way dashboard widget config is.
 */
export const ingestSources = pgTable("ingest_sources", {
  id: uuid("id").primaryKey(),
  kind: ingestKindEnum("kind").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config").notNull().default({}),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type IngestSourceRow = typeof ingestSources.$inferSelect;
export type IngestSourceInsert = typeof ingestSources.$inferInsert;

/**
 * Resume points for pull-based ingesters, one row per upstream feed. The value
 * is whatever opaque token that upstream pages with — for Matrix, a /sync
 * next_batch. The TAK stream is push-side and needs none.
 */
export const ingestCursors = pgTable("ingest_cursors", {
  source: text("source").primaryKey(),
  cursor: text("cursor").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type IngestCursorRow = typeof ingestCursors.$inferSelect;
