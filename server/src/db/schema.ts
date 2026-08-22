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
    createdByIdx: index("events_created_by_idx").on(t.createdBy),
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
