import { editEvent } from "../commands.ts";
import { type CotEvent, destination, type Position, type TakItem } from "../cot.ts";
import { childNamed } from "../protocol/cot-event.ts";
import type { Drawn, Tool } from "./useDrawing.ts";

/**
 * Moving and reshaping existing items. The new geometry is written back in
 * the item's own format and everything else in its detail stays as it was.
 */

const CIRCLE_STEPS = 64;
const UNKNOWN = 9_999_999;
/** Terra-draw refuses coordinates more precise than this. */
const PRECISION = 9;

const rounded = (p: Position): Position => [
  Number(p[0].toFixed(PRECISION)),
  Number(p[1].toFixed(PRECISION)),
];

export type EditTarget =
  | { tool: Tool; geometry: { type: "Point"; coordinates: Position } }
  | { tool: Tool; geometry: { type: "LineString"; coordinates: Position[] } }
  | { tool: Tool; geometry: { type: "Polygon"; coordinates: Position[][] } };

/** What to put on the drawing layer to edit `item`; undefined when its geometry can't be edited. */
export const editTarget = (item: TakItem): EditTarget | undefined => {
  if (item.team || item.rangeBearing || item.footprint || item.emergency) return undefined;
  const g = item.geometry;
  if (item.ellipse) {
    // An ellipse is edited as its enclosing circle; only a true circle can be resized.
    const centre = g.coordinates as Position;
    const ring = Array.from({ length: CIRCLE_STEPS }, (_, i) =>
      rounded(destination(centre, item.ellipse?.major ?? 0, (i * 360) / CIRCLE_STEPS)),
    );
    return {
      tool: "circle",
      geometry: { type: "Polygon", coordinates: [[...ring, ring[0] as Position]] },
    };
  }
  if (g.type === "Point")
    return { tool: "marker", geometry: { type: "Point", coordinates: rounded(g.coordinates) } };
  if (g.type === "LineString")
    return {
      tool: item.type === "b-m-r" ? "route" : "line",
      geometry: { type: "LineString", coordinates: g.coordinates.map(rounded) },
    };
  return {
    tool: item.type === "u-d-r" ? "rectangle" : "polygon",
    geometry: { type: "Polygon", coordinates: g.coordinates.map((ring) => ring.map(rounded)) },
  };
};

const positionOf = (link: Element): Position => {
  const [lat, lon] = (link.getAttribute("point") ?? "").split(",").map(Number);
  return [lon ?? Number.NaN, lat ?? Number.NaN];
};

const key = ([lon, lat]: Position) => `${lat.toFixed(7)},${lon.toFixed(7)}`;

/** Index pairs of the longest common subsequence of `a` and `b`. */
const commonPairs = (a: string[], b: string[]): [number, number][] => {
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  const length = (i: number, j: number) => lengths[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[i] === b[j] ? length(i + 1, j + 1) + 1 : Math.max(length(i + 1, j), length(i, j + 1));
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (length(i + 1, j) >= length(i, j + 1)) i++;
    else j++;
  }
  return pairs;
};

const squaredDistance = (p: Position, q: Position) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;

/** Pairs every point of the shorter list with one of the longer, in order, as close as possible. */
const closestPairs = (a: Position[], b: Position[]): [number, number][] => {
  if (a.length > b.length) return closestPairs(b, a).map(([j, i]) => [i, j]);
  const width = b.length + 1;
  const best = new Float64Array((a.length + 1) * width);
  const cost = (i: number, j: number) => best[i * width + j] ?? 0;
  const pairCost = (i: number, j: number) =>
    squaredDistance(a[i] as Position, b[j] as Position) + cost(i + 1, j + 1);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length; j >= 0; j--) {
      const room = b.length - j >= a.length - i;
      best[i * width + j] = !room
        ? Number.POSITIVE_INFINITY
        : Math.min(pairCost(i, j), b.length - j > a.length - i ? cost(i, j + 1) : Infinity);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length; j++) {
    if (pairCost(i, j) === cost(i, j)) pairs.push([i++, j]);
  }
  return pairs;
};

/**
 * Rewrites the `<link point>` vertices to `points`. Vertices that didn't move
 * keep their link as is, moved ones keep their link (a route checkpoint keeps
 * its name and uid) with a new point, and added ones get a new link: a route's
 * as an unnamed control point, like ATAK inserts.
 */
const relink = (detail: Element, points: Position[], route: boolean) => {
  const old = Array.from(detail.children).filter(
    (el) => el.tagName === "link" && el.hasAttribute("point"),
  );
  const anchor = old[0];
  if (!anchor) return;
  const doc = detail.ownerDocument;
  const added = ([lon, lat]: Position) => {
    const link = doc.createElementNS(null, "link");
    if (route) {
      link.setAttribute("uid", crypto.randomUUID());
      link.setAttribute("callsign", "");
      link.setAttribute("type", "b-m-p-c");
    }
    link.setAttribute("point", `${lat},${lon}`);
    if (route) {
      link.setAttribute("remarks", "");
      link.setAttribute("relation", "c");
    }
    return link;
  };
  const moved = (link: Element, [lon, lat]: Position) => {
    link.setAttribute("point", `${lat},${lon}`);
    return link;
  };
  const oldPoints = old.map(positionOf);
  const result: Element[] = [];
  let [i, j] = [0, 0];
  // Between two unchanged vertices, each old one moved to the nearest new point; the rest were removed or added.
  const fillGap = (oldEnd: number, newEnd: number) => {
    const pairs = closestPairs(oldPoints.slice(i, oldEnd), points.slice(j, newEnd));
    const reused = new Map(pairs.map(([o, n]) => [n + j, old[o + i] as Element]));
    for (let k = j; k < newEnd; k++) {
      const point = points[k] as Position;
      const link = reused.get(k);
      result.push(link ? moved(link, point) : added(point));
    }
  };
  for (const [oi, nj] of commonPairs(oldPoints.map(key), points.map(key))) {
    fillGap(oi, nj);
    result.push(old[oi] as Element);
    [i, j] = [oi + 1, nj + 1];
  }
  fillGap(old.length, points.length);
  const slot = doc.createComment("");
  detail.insertBefore(slot, anchor);
  for (const link of old) link.remove();
  for (const link of result) detail.insertBefore(link, slot);
  slot.remove();
};

const centreOf = (points: Position[]): Position => {
  const sum = points.reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
};

/** ATAK closes a polygon by repeating its first vertex; a rectangle is its four corners. */
const verticesOf = (drawn: Exclude<Drawn, { kind: "marker" | "circle" }>) =>
  drawn.kind === "polygon" ? [...drawn.points, drawn.points[0] as Position] : drawn.points;

/** The item re-issued with the geometry it was edited to. */
export const editGeometryEvent = (item: TakItem, drawn: Drawn, now = Date.now()): CotEvent => {
  const event = editEvent(
    item,
    (detail) => {
      if (drawn.kind === "marker") return;
      if (drawn.kind !== "circle") return relink(detail, verticesOf(drawn), item.type === "b-m-r");
      const ellipse = childNamed(childNamed(detail, "shape") ?? detail, "ellipse");
      if (ellipse && item.ellipse?.major === item.ellipse?.minor) {
        ellipse.setAttribute("major", String(drawn.radius));
        ellipse.setAttribute("minor", String(drawn.radius));
      }
    },
    now,
  );
  // A route's event point means nothing (ATAK sends 0,0); a shape's is its centre.
  if (drawn.kind === "route") return event;
  const [lon, lat] =
    drawn.kind === "marker"
      ? drawn.position
      : drawn.kind === "circle"
        ? drawn.centre
        : centreOf(drawn.points);
  if (lon === event.lon && lat === event.lat) return event;
  return { ...event, lon, lat, hae: drawn.kind === "marker" ? UNKNOWN : event.hae };
};
