import { editEvent } from "../commands.ts";
import type { CotEvent, Position, TakItem } from "../cot.ts";
import { anchorOf } from "../items.ts";

/**
 * Moving several items together: every point of each item shifts by the same
 * offset and everything else in its detail stays as it was.
 */

const UNKNOWN = 9_999_999;

/** The middle of the items' anchors: the point a group move carries to where the user clicks. */
export const centreOfItems = (items: TakItem[]): Position => {
  const sum = items.map(anchorOf).reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
  return [sum[0] / items.length, sum[1] / items.length];
};

/** How far `from` must shift to land on `to`, in degrees. */
export const offsetBetween = ([fromLon, fromLat]: Position, [toLon, toLat]: Position): Position => [
  toLon - fromLon,
  toLat - fromLat,
];

// Vertices are "lat,lon" with an optional altitude after them, which stays as it is.
const shiftedPoint = (point: string, [dLon, dLat]: Position) => {
  const [lat, lon, ...rest] = point.split(",");
  return [Number(lat) + dLat, Number(lon) + dLon, ...rest].join(",");
};

// ponytail: shifts in degrees, so a group tens of kilometres north–south stretches slightly east–west; move along a bearing in metres if that matters.
/**
 * The item re-issued `by` degrees away. Its event point and every vertex link
 * (shape corners, route points, tactical graphic control points) move; a
 * circle's radius and everything else stay.
 */
export const movedEvent = (item: TakItem, by: Position, now = Date.now()): CotEvent => {
  const event = editEvent(
    item,
    (detail) => {
      for (const link of Array.from(detail.children)) {
        const point = link.tagName === "link" && link.getAttribute("point");
        if (point) link.setAttribute("point", shiftedPoint(point, by));
      }
    },
    now,
  );
  // A route's event point means nothing (ATAK sends 0,0).
  if (item.type === "b-m-r") return event;
  // The altitude was for the old spot.
  return { ...event, lon: event.lon + by[0], lat: event.lat + by[1], hae: UNKNOWN };
};
