import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { Position, TakItem } from "../cot.ts";
import { hasPosition } from "../items.ts";
import { groupOf, isHidden } from "../overlays.ts";

/** What a map keeps in view: items by callsign, a mission's items, overlay groups. */
export type Follow = { callsigns?: string[]; mission?: string; groups?: string[] };

// A wall map moves at most this often, so a steady stream of positions doesn't make it jitter.
const FOLLOW_CHECK_MS = 3000;
const FOLLOW_PADDING_PX = 48;
const FOLLOW_MAX_ZOOM = 15;

export const followedItems = (
  items: TakItem[],
  follow: Follow,
  missionUids: ReadonlySet<string>,
): TakItem[] => {
  const callsigns = new Set(follow.callsigns);
  const groups = new Set(follow.groups);
  return items.filter(
    (item) =>
      hasPosition(item) &&
      ((item.callsign !== undefined && callsigns.has(item.callsign)) ||
        missionUids.has(item.uid) ||
        isHidden(groupOf(item), groups)),
  );
};

export const positionsOf = (items: TakItem[]): Position[] =>
  items.flatMap(({ geometry: g }) =>
    g.type === "Point"
      ? [g.coordinates]
      : g.type === "LineString"
        ? g.coordinates
        : g.coordinates.flat(),
  );

/** South-west and north-east corners. A loop: Math.min(...) throws past ~100k arguments. */
export const boundsOf = (positions: Position[]): [Position, Position] | undefined => {
  if (positions.length === 0) return undefined;
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lng, lat] of positions) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
};

/** Whether every screen point sits at least `margin` px inside a `width` × `height` view. */
export const allInView = (
  points: { x: number; y: number }[],
  width: number,
  height: number,
  margin: number,
): boolean =>
  points.every(
    ({ x, y }) => x >= margin && x <= width - margin && y >= margin && y <= height - margin,
  );

/**
 * Fits the map to `positions` whenever one of them nears the edge of the view,
 * checking every few seconds; while they all stay well inside, the map holds still.
 */
export const useFollow = (map: MapLibreMap | undefined, positions: Position[]) => {
  const latest = useRef(positions);
  latest.current = positions;
  useEffect(() => {
    if (!map) return;
    const check = () => {
      const bounds = boundsOf(latest.current);
      if (!bounds || map.isMoving()) return;
      const { clientWidth: width, clientHeight: height } = map.getContainer();
      // Never more than a quarter of a small widget, or MapLibre can't fit anything.
      const padding = Math.min(FOLLOW_PADDING_PX, width / 4, height / 4);
      const points = latest.current.map((p) => map.project(p));
      if (allInView(points, width, height, padding / 2)) return;
      map.fitBounds(bounds, { padding, maxZoom: FOLLOW_MAX_ZOOM, bearing: map.getBearing() });
    };
    check();
    const timer = setInterval(check, FOLLOW_CHECK_MS);
    return () => clearInterval(timer);
  }, [map]);
};
