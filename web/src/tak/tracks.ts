import type { Feature, FeatureCollection } from "geojson";
import type { Position, TakItem } from "./cot.ts";
import { distance } from "./geo.ts";
import { hasPosition, teamColor } from "./items.ts";
import { groupOf, isHidden } from "./overlays.ts";
import type { CotEvent } from "./protocol/cot-event.ts";

/**
 * Where moving items have been, drawn like ATAK's breadcrumb trail: a line in
 * the item's team colour (or affiliation colour for units) with a dot per fix.
 */

export type TrackPoint = { position: Position; time: number };

export const TRACK_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const TRACK_MAX_POINTS = 500;
// ATAK's default bread_dist_threshold: closer fixes are GPS jitter, not movement.
const MIN_STEP_M = 2;

// ATAK's Marker.getAffiliationColor, used when an item has no team.
const AFFILIATION_COLOR: [prefix: string, color: string][] = [
  ["a-f-A-C", "#ffa1ff"],
  ["a-f-G-E-V-C", "#ffa1ff"],
  ["a-f", "#80e0ff"],
  ["a-h", "#ff8080"],
  ["a-n", "#aaffaa"],
  ["a-u", "#e1ff80"],
];

const isFix = ({ position: [lon, lat] }: TrackPoint) => lon !== 0 || lat !== 0;

/**
 * `track` with `added` merged in time order, trimmed to the last
 * `TRACK_MAX_AGE_MS` before `now` and at most `TRACK_MAX_POINTS` points.
 */
export const mergeTrack = (track: TrackPoint[], added: TrackPoint[], now: number): TrackPoint[] => {
  const since = now - TRACK_MAX_AGE_MS;
  const sorted = [...track, ...added]
    .filter((p) => p.time >= since && isFix(p))
    .sort((a, b) => a.time - b.time);
  const kept: TrackPoint[] = [];
  for (const point of sorted) {
    const last = kept.at(-1);
    if (!last || distance(last.position, point.position) >= MIN_STEP_M) kept.push(point);
  }
  return kept.slice(-TRACK_MAX_POINTS);
};

export const trackPointOf = (event: CotEvent): TrackPoint => ({
  position: [event.lon, event.lat],
  time: event.time,
});

export const trackColor = (item: TakItem): string =>
  item.team
    ? teamColor(item.team)
    : (AFFILIATION_COLOR.find(([prefix]) => item.type.startsWith(prefix))?.[1] ?? "#ffffff");

type TrackDrawing = { item: TakItem; features: Feature[] };
// Track arrays are replaced, never changed, when a point arrives: an unchanged trail keeps its
// features, so a thousand long trails aren't rebuilt (or compared point by point) per update.
const drawnTracks = new WeakMap<TrackPoint[], TrackDrawing>();

const trackDrawing = (item: TakItem, track: TrackPoint[]): Feature[] => {
  const drawn = drawnTracks.get(track);
  if (drawn?.item === item) return drawn.features;
  const crumbs = track.map((p) => p.position);
  const line =
    hasPosition(item) && item.geometry.type === "Point"
      ? [...crumbs, item.geometry.coordinates]
      : crumbs;
  const properties = { uid: item.uid, color: trackColor(item) };
  const features: Feature[] =
    line.length < 2
      ? []
      : [
          { type: "Feature", geometry: { type: "LineString", coordinates: line }, properties },
          { type: "Feature", geometry: { type: "MultiPoint", coordinates: crumbs }, properties },
        ];
  drawnTracks.set(track, { item, features });
  return features;
};

/** The tracks of `items` that aren't hidden, each ending at the item's current position. */
export const trackFeatures = (
  items: TakItem[],
  tracks: ReadonlyMap<string, TrackPoint[]>,
  hidden: ReadonlySet<string>,
): FeatureCollection => {
  const features: Feature[] = [];
  for (const item of items) {
    const track = tracks.get(item.uid);
    if (!track?.length || item.geometry.type !== "Point" || isHidden(groupOf(item), hidden))
      continue;
    features.push(...trackDrawing(item, track));
  }
  return { type: "FeatureCollection", features };
};
