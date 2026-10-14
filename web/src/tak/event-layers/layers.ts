import { DEFAULT_THEME } from "@mantine/core";
import type { Feature, FeatureCollection, Point } from "geojson";
import { z } from "zod";
import type { EventResponse } from "../../api.ts";
import { matchesFeed, queryFor } from "../../event-binding/filter.ts";
import { optionSchema, STATUS_COLORS, type StatusColor } from "../../event-binding/options.ts";
import { getPath } from "../../event-binding/paths.ts";
import { type EventQuery, eventQueryShape, queryFilter } from "../../event-binding/query.ts";
import type { LiveEventsOptions } from "../../live-events.ts";

/**
 * A BattleLog layer: the located events matching a query, drawn on the TAK
 * map beside (never as) TAK items. Definitions are shared by everyone, each
 * stored as an event of this type; a layer is "deleted" by a version marking it so.
 */
export const LAYER_EVENT_TYPE = "map-layer";

export const MAX_LAYER_EVENTS = 500;

const HOUR_MS = 60 * 60 * 1000;

export const layerSchema = z.object({
  name: z.string().max(80).default(""),
  query: z.object(eventQueryShape).default({}),
  /** Only events from the last this many hours; none = however old. */
  windowHours: z
    .number()
    .positive()
    .max(24 * 365)
    .optional(),
  color: z.enum(STATUS_COLORS).default("blue"),
  /** Dot path into `data` shown as the label; empty = the header. */
  labelPath: z.string().max(200).default(""),
  /** Colours by the value at this path, falling back to `color`. */
  colorBy: z
    .object({ path: z.string().max(200).default(""), options: z.array(optionSchema).default([]) })
    .optional(),
  deleted: z.boolean().optional(),
});

export type LayerDefinition = z.infer<typeof layerSchema>;

export type EventLayer = { eventId: string; rowId: string; definition: LayerDefinition };

export const parseLayer = (data: unknown): LayerDefinition | undefined => {
  const parsed = layerSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
};

export const layersOf = (rows: EventResponse[]): EventLayer[] =>
  rows
    .flatMap((row) => {
      const definition = row.type === LAYER_EVENT_TYPE ? parseLayer(row.data) : undefined;
      return definition && !definition.deleted
        ? [{ eventId: row.eventId, rowId: row.id, definition }]
        : [];
    })
    .sort((a, b) => a.definition.name.localeCompare(b.definition.name));

export const newLayer = (): LayerDefinition => ({
  name: "",
  query: { types: "", tags: "", dataFilters: [] },
  windowHours: 24,
  color: "blue",
  labelPath: "",
});

export const colorHex = (color: StatusColor) => DEFAULT_THEME.colors[color][5];

/** When an event happened, for windows and replay: logged time when it has none of its own. */
export const eventMoment = (event: EventResponse) => Date.parse(event.eventTime ?? event.createdAt);

/**
 * What to fetch for a layer: its query, located events only, that happened since
 * the window opened. Rounded down to the hour so the query (and its fetch)
 * changes hourly, not every render; {@link inWindow} cuts exactly.
 * Replaying reaches back as far as the replay does.
 */
export const layerFetch = (
  query: EventQuery,
  windowHours: number | undefined,
  now: number,
  replayWindowMs = 0,
) => {
  const filter = queryFilter(query);
  if (!filter) return undefined;
  const from =
    windowHours === undefined
      ? undefined
      : Math.floor((now - replayWindowMs - windowHours * HOUR_MS) / HOUR_MS) * HOUR_MS;
  // Cast like queryFor: dates travel as strings.
  const fetchQuery = {
    ...queryFor(filter),
    located: "true",
    ...(from === undefined ? {} : { occurredFrom: new Date(from).toISOString() }),
  } as LiveEventsOptions["query"];
  return {
    query: fetchQuery,
    match: (event: EventResponse) => !!event.locationPoint && matchesFeed(event, filter),
  };
};

/** Whether the event belongs on the map at moment `at`: happened by then, and within the window. */
export const inWindow = (event: EventResponse, windowHours: number | undefined, at: number) => {
  const moment = eventMoment(event);
  if (moment > at) return false;
  return windowHours === undefined || moment >= at - windowHours * HOUR_MS;
};

const text = (v: unknown) =>
  v === null || v === undefined || typeof v === "object" ? "" : String(v);

export const labelOfEvent = (event: EventResponse, labelPath: string) =>
  (labelPath.trim() && text(getPath(event.data, labelPath.trim()))) || event.header;

export const colorOfEvent = (event: EventResponse, definition: LayerDefinition): StatusColor => {
  const value = colorByValue(event, definition);
  return definition.colorBy?.options.find((o) => o.value === value)?.color ?? definition.color;
};

const colorByValue = (event: EventResponse, definition: LayerDefinition) => {
  const path = definition.colorBy?.path.trim();
  return path ? text(getPath(event.data, path)) : "";
};

/** The value a layer colours by goes in the label too: colour alone is lost on colour-blind users. */
const labelWithValue = (event: EventResponse, definition: LayerDefinition) => {
  const label = labelOfEvent(event, definition.labelPath);
  const value = colorByValue(event, definition);
  return value && value !== label ? `${label} · ${value}` : label;
};

export type EventFeature = Feature<
  Point,
  { eventId: string; layerId: string; label: string; color: string }
>;

export const layerFeatures = (
  layer: EventLayer,
  events: EventResponse[],
  at: number,
): EventFeature[] =>
  events.flatMap((event) =>
    event.locationPoint && inWindow(event, layer.definition.windowHours, at)
      ? [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [event.locationPoint.lng, event.locationPoint.lat],
            },
            properties: {
              eventId: event.eventId,
              layerId: layer.eventId,
              label: labelWithValue(event, layer.definition),
              color: colorHex(colorOfEvent(event, layer.definition)),
            },
          },
        ]
      : [],
  );

export const featureCollection = (
  features: EventFeature[],
): FeatureCollection<Point, EventFeature["properties"]> => ({
  type: "FeatureCollection",
  features,
});
