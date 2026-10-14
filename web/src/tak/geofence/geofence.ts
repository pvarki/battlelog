import {
  type CotEvent,
  GEOFENCE_BREACH_TYPE,
  type Geofence,
  type Position,
  type TakItem,
} from "../cot.ts";
import { distance } from "../geo.ts";
import type { Sender } from "../identity.ts";
import { anchorOf, hasPosition, labelOf } from "../items.ts";
import { escapeXml } from "../protocol/cot-xml.ts";

/**
 * ATAK-style geofences, watched in this browser: a closed shape carrying
 * `__geofence` with tracking on alerts when an item it watches crosses it.
 */

export const MONITOR_LABEL: Record<Geofence["monitor"], string> = {
  TAKUsers: "TAK users",
  Friendly: "Friendly units",
  Hostile: "Hostile units",
  All: "All units",
  Custom: "Custom list (set in ATAK)",
};

/** ATAK fences closed shapes: polygons, rectangles and circles. */
export const canBeFence = (item: TakItem): boolean =>
  (item.type === "u-d-c-c" && !!item.ellipse) ||
  ((item.type === "u-d-r" || item.type.startsWith("u-d-f")) && item.geometry.type === "Polygon");

const insideRing = ([x, y]: Position, ring: Position[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export const fenceContains = (fence: TakItem, point: Position): boolean => {
  const g = fence.geometry;
  if (g.type === "Point")
    return !!fence.ellipse && distance(g.coordinates, point) <= fence.ellipse.major;
  return g.type === "Polygon" && insideRing(point, g.coordinates[0] ?? []);
};

/** "Custom" is a list ATAK keeps on the device that drew the fence; nothing here matches it. */
export const isWatched = (fence: Geofence, item: TakItem): boolean => {
  if (item.geometry.type !== "Point" || !item.type.startsWith("a-") || !hasPosition(item))
    return false;
  if (item.offline) return false;
  switch (fence.monitor) {
    case "TAKUsers":
      return !!item.team;
    case "Friendly":
      return item.type.startsWith("a-f-");
    case "Hostile":
      return item.type.startsWith("a-h-");
    case "All":
      return true;
    case "Custom":
      return false;
  }
};

export type FenceWatch = { inside: boolean; alertedAt?: number };
/** Where each watched item was against each fence, by `fenceUid itemUid`. */
export type FenceState = ReadonlyMap<string, FenceWatch>;
export type Crossing = { fence: TakItem; item: TakItem; entered: boolean; time: number };

// GPS jitter along a fence line would otherwise alert on every flip.
export const REALERT_AFTER_MS = 60_000;

const fires = (trigger: Geofence["trigger"], entered: boolean) =>
  trigger === "Both" || (trigger === "Entry") === entered;

/**
 * Compares where watched items are now with where they were. Only a change
 * of side alerts: the first sighting of an item just records which side it's
 * on, so opening the map doesn't alert for everything already inside.
 */
export const checkFences = (
  previous: FenceState,
  items: TakItem[],
  now: number,
): { state: FenceState; crossings: Crossing[] } => {
  const state = new Map<string, FenceWatch>();
  const crossings: Crossing[] = [];
  for (const fence of items) {
    const geofence = fence.geofence;
    if (!geofence?.tracking || !canBeFence(fence)) continue;
    for (const item of items) {
      if (!isWatched(geofence, item)) continue;
      const key = `${fence.uid} ${item.uid}`;
      const inside = fenceContains(fence, anchorOf(item));
      const before = previous.get(key);
      let alertedAt = before?.alertedAt;
      const quiet = alertedAt !== undefined && now - alertedAt < REALERT_AFTER_MS;
      if (before && before.inside !== inside && fires(geofence.trigger, inside) && !quiet) {
        crossings.push({ fence, item, entered: inside, time: now });
        alertedAt = now;
      }
      state.set(key, { inside, alertedAt });
    }
  }
  return { state, crossings };
};

export const describeCrossing = ({ fence, item, entered }: Crossing) =>
  `${labelOf(item)} ${entered ? "entered" : "left"} ${labelOf(fence)}`;

const ALERT_LIFETIME_MS = 10 * 60_000;
const UNKNOWN = 9_999_999;

/** ATAK's geofence breach alert, from us, at where the item crossed. */
export const breachEvent = (crossing: Crossing, sender: Sender, now = Date.now()): CotEvent => {
  const [lon, lat] = anchorOf(crossing.item);
  const name = crossing.item.callsign ?? crossing.item.uid;
  return {
    uid: `${crossing.fence.uid}.${crossing.item.uid}.breach`,
    type: GEOFENCE_BREACH_TYPE,
    how: "h-e",
    time: now,
    start: now,
    stale: now + ALERT_LIFETIME_MS,
    lat,
    lon,
    hae: UNKNOWN,
    ce: UNKNOWN,
    le: UNKNOWN,
    detail: [
      `<link uid="${escapeXml(sender.uid)}" type="a-f-G-U-C" relation="p-p" parent_callsign="${escapeXml(sender.callsign)}"/>`,
      `<contact callsign="${escapeXml(`${name}-Alert`)}"/>`,
      `<emergency type="Geo-fence Breached">${escapeXml(name)}</emergency>`,
      `<remarks>${escapeXml(describeCrossing(crossing))}</remarks>`,
    ].join(""),
  };
};
