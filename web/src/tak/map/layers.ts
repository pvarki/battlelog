import type { Feature, FeatureCollection } from "geojson";
import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import { destination, type Position, type Sensor, type TakItem } from "../cot.ts";
import { distance, EARTH_RADIUS_M, formatDistance } from "../geo.ts";
import { hasPosition, labelOf, statusOf } from "../items.ts";
import { groupOf, isHidden } from "../overlays.ts";
import { iconsetsVersion } from "./iconsets.ts";
import { BETWEEN_SPOKES, bullseyeMarks, bullseyeRadii, circleLine } from "./rings.ts";
import { geoJsonSource, SOURCE_NAMES, type SourceName } from "./sources.ts";
import {
  arrowhead,
  iconFor,
  keepUsedLabels,
  type LabelStyle,
  labelImage,
  type MapImage,
  markLabelsUsed,
  pruneLabels,
  recordLabels,
  referenceDot,
} from "./symbols.ts";
import {
  labelMinZoom,
  markTacticalDrawn,
  pruneTactical,
  tacticalFeatures,
  tacticalReady,
} from "./tactical.ts";

// ATAK hides marker names beyond 10 m per pixel, about zoom 12 at Finnish latitudes.
const MARKER_LABEL_MIN_ZOOM = 12;

/** For a label layer: each label waits for its own `minZoom`, a marker's or its shape's size. */
export const LABEL_ZOOM_FILTER: FilterSpecification = [
  ">=",
  ["zoom"],
  ["coalesce", ["get", "minZoom"], 0],
];

/**
 * Items as the GeoJSON sources the map draws, following ATAK's conventions:
 * marker names under the icon; closed shapes get a centre dot carrying their
 * name; open lines and measurements are labelled only when the drawing has
 * labels switched on; route waypoints show as named dots.
 */

export type Sources = Record<SourceName, FeatureCollection> & {
  /** Some graphic is still rendering: drawn plain for now, onTacticalRendered tells when it's ready. */
  graphicsPending: boolean;
};

const CIRCLE_STEPS = 64;
const DEFAULT_STROKE = "#ffffff";
const RANGE_BEARING_COLOR = "#ff0000";
const SPI_LINE = "#cccccc";
const LABEL_GAP = 2;
// Drawn last = on top: people over units over markers.
const DRAW_ORDER = [
  "shapes",
  "navigation",
  "other",
  "markers/spot",
  "markers/unknown",
  "markers/neutral",
  "markers/friendly",
  "markers/hostile",
  "markers/team",
  "alerts",
];

const RAD = Math.PI / 180;

/**
 * Rotation for text along a segment on a map turned to `bearing`, flipped so
 * it never reads upside down on screen.
 */
const textAngle = ([lon1, lat1]: Position, [lon2, lat2]: Position, bearing: number) => {
  const east = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * RAD);
  const north = lat2 - lat1;
  const onScreen = ((((-Math.atan2(north, east) / RAD - bearing + 540) % 360) + 360) % 360) - 180;
  const upright = onScreen > 90 ? onScreen - 180 : onScreen < -90 ? onScreen + 180 : onScreen;
  return upright + bearing;
};

/**
 * ATAK's tactical overlay colours for a rectangle's four sides (`ring` closed,
 * first edge = front), worked out the way ATAK does: white front, black back,
 * and red/green on whichever sides are left/right of the front.
 */
export const tacticalOverlayColors = (ring: Position[]): string[] => {
  const mids = [0, 1, 2, 3].map((i) => midpoint(ring[i] as Position, ring[i + 1] as Position));
  const [front, right, back, left] = mids as [Position, Position, Position, Position];
  const heading = compassBearing(back, front);
  const toFront = (from: Position) => (((compassBearing(from, front) - heading) % 360) + 360) % 360;
  const leftIsLeft = toFront(left) < 180 && toFront(right) > 180;
  return [
    "#ffffff",
    leftIsLeft ? "#00ff00" : "#ff0000",
    "#000000",
    leftIsLeft ? "#ff0000" : "#00ff00",
  ];
};

const compassBearing = ([lon1, lat1]: Position, [lon2, lat2]: Position) => {
  const east = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * RAD);
  return (((Math.atan2(east, lat2 - lat1) / RAD) % 360) + 360) % 360;
};

const midpoint = ([lon1, lat1]: Position, [lon2, lat2]: Position): Position => [
  (lon1 + lon2) / 2,
  (lat1 + lat2) / 2,
];

/**
 * An ellipse as a polygon: `major` and `minor` are semi-axes in metres, `angle`
 * turns the major axis clockwise from north. Equirectangular is accurate
 * enough at drawing sizes.
 */
const ellipseRing = (
  [lon, lat]: Position,
  { major, minor, angle }: NonNullable<TakItem["ellipse"]>,
) => {
  const metresPerDegLat = (EARTH_RADIUS_M * Math.PI) / 180;
  const metresPerDegLon = metresPerDegLat * Math.cos(lat * RAD);
  const turn = angle * RAD;
  const ring: Position[] = [];
  for (let i = 0; i <= CIRCLE_STEPS; i++) {
    const a = (i / CIRCLE_STEPS) * 2 * Math.PI;
    const alongMajor = major * Math.cos(a);
    const alongMinor = minor * Math.sin(a);
    const north = alongMajor * Math.cos(turn) - alongMinor * Math.sin(turn);
    const east = alongMajor * Math.sin(turn) + alongMinor * Math.cos(turn);
    ring.push([lon + east / metresPerDegLon, lat + north / metresPerDegLat]);
  }
  return ring;
};

/** ATAK's sensor field of view: a wedge from the sensor out to its range, centred on its azimuth. */
export const sensorCone = (origin: Position, { azimuth, fov, range }: Sensor): Position[] => {
  const steps = Math.min(72, Math.max(2, Math.ceil(fov / 5)));
  const arc = Array.from({ length: steps + 1 }, (_, i) =>
    destination(origin, range, azimuth - fov / 2 + (fov * i) / steps),
  );
  return [origin, ...arc, origin];
};

/** The average of a ring's corners; good enough to place a name inside a drawn area. */
const centreOf = (ring: Position[]): Position => {
  const corners = ring.slice(0, -1);
  const sum = corners.reduce(([x, y], [lon, lat]) => [x + lon, y + lat], [0, 0]);
  return [sum[0] / corners.length, sum[1] / corners.length];
};

const point = (coordinates: Position, properties: Record<string, unknown>): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties,
});

/** One item's share of each source; `pending` while its tactical graphic is still rendering. */
type ItemFeatures = Record<SourceName, Feature[]> & { pending: boolean };

/** What an item's drawing depends on besides the item itself, which never changes in place. */
type DrawContext = { now: number; bearing: number; byUid: ReadonlyMap<string, TakItem> };

const featuresOf = (
  map: MapLibreMap,
  item: TakItem,
  group: string[],
  { now, bearing, byUid }: DrawContext,
): ItemFeatures => {
  const out: ItemFeatures = {
    points: [],
    shapes: [],
    markerLabels: [],
    lineLabels: [],
    decorations: [],
    tactical: [],
    pending: false,
  };
  const { points, shapes, markerLabels, lineLabels, decorations, tactical } = out;
  // Drafts get a dashed outline so they can't pass for what TAK has.
  const draft = item.draft === true;
  const icon = (uid: string, at: Position, image: MapImage, order: number) =>
    points.push(point(at, { uid, icon: image.id, offset: image.offset, order, draft }));

  /** A name centred under an icon, as ATAK draws marker labels. */
  const nameUnder = (
    uid: string,
    at: Position,
    text: string,
    under: MapImage,
    minZoom = MARKER_LABEL_MIN_ZOOM,
  ) => {
    const label = labelImage(map, text);
    const iconBottom = under.height / 2 + under.offset[1];
    markerLabels.push(
      point(at, {
        uid,
        icon: label.id,
        offset: [0, iconBottom + LABEL_GAP + label.height / 2],
        minZoom,
      }),
    );
  };

  const alongLine = (
    uid: string,
    from: Position,
    to: Position,
    text: string,
    style: LabelStyle = "marker",
    minZoom = 0,
  ) =>
    lineLabels.push(
      point(midpoint(from, to), {
        uid,
        icon: labelImage(map, text, style).id,
        rotate: textAngle(from, to, bearing),
        minZoom,
      }),
    );

  const { uid } = item;
  const stale = statusOf(item, now) !== "online";
  const name = labelOf(item);
  const stroke = item.stroke?.color ?? (item.rangeBearing ? RANGE_BEARING_COLOR : DEFAULT_STROKE);
  const g = item.geometry;

  const graphic = g.type === "Point" ? undefined : tacticalFeatures(map, item, bearing);
  if (!graphic && !tacticalReady(item)) out.pending = true;
  if (graphic) {
    tactical.push(...graphic);
    return out;
  }

  const radii = item.rangeRings ?? (item.bullseye ? bullseyeRadii(item.bullseye) : undefined);
  if (g.type === "Point" && radii) {
    const centre = g.coordinates;
    const strokeLine = (coordinates: Position[], strokeWidth: number) =>
      shapes.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          uid,
          draft,
          stroke,
          strokeOpacity: item.stroke?.opacity ?? 1,
          strokeWidth,
          strokeStyle: "solid",
          fillOpacity: 0,
        },
      });
    const labelsFrom = labelMinZoom(circleLine(centre, Math.max(...radii)));
    const label = (at: Position, text: string) =>
      lineLabels.push(
        point(at, { uid, icon: labelImage(map, text).id, rotate: 0, minZoom: labelsFrom }),
      );
    const ringLabelBearing = item.bullseye ? BETWEEN_SPOKES : 0;
    for (const radius of radii) {
      strokeLine(circleLine(centre, radius), item.strokeWidth ?? 2);
      label(destination(centre, radius, ringLabelBearing), formatDistance(radius));
    }
    if (item.bullseye) {
      const marks = bullseyeMarks(centre, item.bullseye);
      for (const spoke of marks.lines) strokeLine(spoke, 1);
      for (const bearingLabel of marks.labels) label(bearingLabel.at, bearingLabel.text);
    }
    const dot = referenceDot(map, stroke);
    icon(uid, centre, dot, -1);
    nameUnder(uid, centre, name, dot, labelsFrom);
    return out;
  }

  if (g.type === "Point" && !item.ellipse) {
    const image = iconFor(map, item, stale);
    icon(uid, g.coordinates, image, DRAW_ORDER.indexOf(group.slice(0, 2).join("/")));
    if (!item.hideLabel) nameUnder(uid, g.coordinates, name, image);
    // Stale footprints, cones and lines would show where the camera no longer looks.
    if (item.footprint && !stale) {
      shapes.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[...item.footprint, item.footprint[0] as Position]],
        },
        properties: {
          uid,
          stroke,
          strokeOpacity: 1,
          strokeWidth: 2,
          strokeStyle: "solid",
          fill: stroke,
          fillOpacity: 0.15,
        },
      });
    }
    if (item.sensor && !stale) {
      shapes.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [sensorCone(g.coordinates, item.sensor)] },
        properties: {
          uid,
          stroke: item.sensor.stroke.color,
          strokeOpacity: item.sensor.stroke.opacity,
          strokeWidth: 1,
          strokeStyle: "solid",
          fill: item.sensor.fill.color,
          fillOpacity: item.sensor.fill.opacity,
        },
      });
    }
    const sensor = item.sensorUid ? byUid.get(item.sensorUid) : undefined;
    if (sensor?.geometry.type === "Point" && !stale && statusOf(sensor, now) === "online") {
      shapes.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [sensor.geometry.coordinates, g.coordinates],
        },
        properties: {
          uid,
          stroke: SPI_LINE,
          strokeOpacity: 1,
          strokeWidth: 1,
          strokeStyle: "solid",
          fillOpacity: 0,
        },
      });
    }
    return out;
  }

  const ring =
    g.type === "Point" && item.ellipse
      ? ellipseRing(g.coordinates, item.ellipse)
      : g.type === "Polygon"
        ? (g.coordinates[0] ?? [])
        : undefined;
  const line = g.type === "LineString" ? g.coordinates : undefined;
  const overlay =
    item.tacticalOverlay && ring?.length === 5 ? tacticalOverlayColors(ring) : undefined;
  shapes.push({
    type: "Feature",
    geometry: ring
      ? { type: "Polygon", coordinates: [ring] }
      : { type: "LineString", coordinates: line ?? [] },
    properties: {
      uid,
      draft,
      fence: !!(ring && item.geofence),
      stroke,
      // With ATAK's tactical overlay the sides are drawn below, one colour each.
      strokeOpacity: overlay ? 0 : (item.stroke?.opacity ?? 1),
      strokeWidth: item.strokeWidth ?? 3,
      strokeStyle: item.rangeBearing ? "outlined" : (item.strokeStyle ?? "solid"),
      // ATAK fills closed shapes only.
      fill: item.fill?.color ?? DEFAULT_STROKE,
      fillOpacity: ring ? (item.fill?.opacity ?? 0) : 0,
    },
  });

  for (const [i, color] of (overlay ?? []).entries()) {
    shapes.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [ring?.[i] as Position, ring?.[i + 1] as Position],
      },
      properties: {
        uid,
        draft,
        stroke: color,
        strokeOpacity: 1,
        strokeWidth: (item.strokeWidth ?? 3) + 1,
        strokeStyle: "outlined",
        fillOpacity: 0,
      },
    });
  }

  if (ring) {
    const centre = g.type === "Point" ? g.coordinates : centreOf(ring);
    const dot = referenceDot(map, stroke);
    const labelsFrom = labelMinZoom(ring);
    icon(uid, centre, dot, -1);
    nameUnder(uid, centre, name, dot, labelsFrom);
    if (item.labelsOn && item.ellipse) {
      const { major, minor } = item.ellipse;
      const text =
        major === minor
          ? formatDistance(major)
          : `W: ${formatDistance(minor * 2)}  L: ${formatDistance(major * 2)}`;
      const top = ring.reduce((a, b) => (b[1] > a[1] ? b : a));
      lineLabels.push(
        point(top, { uid, icon: labelImage(map, text).id, rotate: 0, minZoom: labelsFrom }),
      );
    }
    if (item.labelsOn && item.type === "u-d-r") {
      for (let i = 0; i + 1 < ring.length; i++) {
        const [a, b] = [ring[i] as Position, ring[i + 1] as Position];
        alongLine(uid, a, b, formatDistance(distance(a, b)), "marker", labelsFrom);
      }
    }
    return out;
  }

  if (!line || line.length < 2) return out;
  if (item.rangeBearing) {
    const { range, bearing: heading, northRef } = item.rangeBearing;
    const [from, to] = [line[0] as Position, line[1] as Position];
    const arrow = heading >= 180 ? "←" : "→";
    alongLine(
      uid,
      from,
      to,
      `${arrow} ${Math.round(heading)}°${northRef}   ${formatDistance(range)}`,
      "emphasis",
    );
    decorations.push(point(to, { uid, icon: arrowhead(map, stroke).id, rotate: heading }));
    return out;
  }
  if (item.labelsOn) {
    const middle = Math.floor((line.length - 1) / 2);
    const [a, b] = [line[middle] as Position, line[middle + 1] as Position];
    alongLine(uid, a, b, name, "marker", labelMinZoom(line));
  }
  for (const waypoint of item.waypoints ?? []) {
    const dot = referenceDot(map, stroke);
    icon(uid, waypoint.position, dot, -1);
    nameUnder(uid, waypoint.position, waypoint.name, dot);
  }
  return out;
};

type Cached = ItemFeatures & { context: string; labels: string[] };

// Per map: each registers its own images, so features drawn for one can't be shown on another.
const drawings = new WeakMap<MapLibreMap, WeakMap<TakItem, Cached>>();

/** The inputs besides the item that change its drawing: when they're the same, so is the drawing. */
const contextOf = (item: TakItem, { now, bearing, byUid }: DrawContext) => {
  const sensor = item.sensorUid ? byUid.get(item.sensorUid) : undefined;
  return [
    statusOf(item, now),
    bearing,
    iconsetsVersion(),
    sensor ? `${statusOf(sensor, now)}${JSON.stringify(sensor.geometry.coordinates)}` : "",
  ].join("|");
};

/** An item's features, redrawn only when the item or what it depends on changed. */
const cachedFeaturesOf = (
  map: MapLibreMap,
  item: TakItem,
  group: string[],
  context: DrawContext,
): ItemFeatures => {
  let cache = drawings.get(map);
  if (!cache) {
    cache = new WeakMap();
    drawings.set(map, cache);
  }
  const key = contextOf(item, context);
  const hit = cache.get(item);
  // The labels and graphic it shows are still in use: pruning must keep them.
  if (hit?.context === key && markLabelsUsed(map, hit.labels)) {
    markTacticalDrawn(item);
    return hit;
  }
  const [features, labels] = recordLabels(() => featuresOf(map, item, group, context));
  // A graphic still rendering is drawn plain for now; the next redraw has the real one.
  if (!features.pending) cache.set(item, { ...features, context: key, labels });
  return features;
};

/** The picture by item: which are drawn, and each one's features. */
const pictureOf = (
  map: MapLibreMap,
  items: TakItem[],
  hidden: ReadonlySet<string>,
  now: number,
  bearing: number,
  cached: boolean,
) => {
  const shown = items.flatMap((item) => {
    const group = groupOf(item);
    return isHidden(group, hidden) || !hasPosition(item) ? [] : [{ item, group }];
  });
  // Only shown items, so a hidden drone takes its SPI line with it.
  const byUid = new Map(shown.map(({ item }) => [item.uid, item]));
  const context: DrawContext = { now, bearing, byUid };
  const drawn = new Map<string, ItemFeatures>();
  for (const { item, group } of shown) {
    drawn.set(
      item.uid,
      cached ? cachedFeaturesOf(map, item, group, context) : featuresOf(map, item, group, context),
    );
  }
  return drawn;
};

const collection = (features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

const sourcesOf = (drawn: ReadonlyMap<string, ItemFeatures>): Sources => {
  const sources = Object.fromEntries(
    SOURCE_NAMES.map((name) => [name, collection([...drawn.values()].flatMap((f) => f[name]))]),
  ) as Record<SourceName, FeatureCollection>;
  return { ...sources, graphicsPending: [...drawn.values()].some((f) => f.pending) };
};

/** The drawing preview: a few items, drawn afresh, and no say in which images the picture keeps. */
export const toSources = (
  map: MapLibreMap,
  items: TakItem[],
  hidden: ReadonlySet<string>,
  now: number,
  /** The map's rotation, so line labels stay readable when it turns. */
  bearing: number,
): Sources => {
  const sources = sourcesOf(pictureOf(map, items, hidden, now, bearing, false));
  keepUsedLabels();
  return sources;
};

/** A feature's id in its source: the item's uid and its place among that item's features there. */
const featureId = (uid: string, index: number) => `${uid}\u0000${index}`;

const withIds = (uid: string, features: Feature[]) =>
  features.map((f, i) => ({ ...f, id: featureId(uid, i) }));

/**
 * What one source needs to go from `shown` to `drawn`: the features of items
 * that changed or arrived (same ids replace), and ids an item no longer has.
 * Unchanged items are the same object, so they cost nothing.
 */
export const sourceDiff = (
  shown: ReadonlyMap<string, Pick<ItemFeatures, SourceName>>,
  drawn: ReadonlyMap<string, Pick<ItemFeatures, SourceName>>,
  name: SourceName,
) => {
  const remove: string[] = [];
  const add: Feature[] = [];
  for (const [uid, before] of shown) {
    const after = drawn.get(uid);
    if (after === before) continue;
    for (let i = after?.[name].length ?? 0; i < before[name].length; i++)
      remove.push(featureId(uid, i));
  }
  for (const [uid, after] of drawn) {
    if (shown.get(uid) !== after) add.push(...withIds(uid, after[name]));
  }
  return { remove, add };
};

/**
 * Draws the picture onto the `${prefix}-…` sources and keeps it drawn: each
 * redraw works out only the items that changed and sends the map just those,
 * so a position report costs one item, not the whole picture.
 */
export const createPictureDrawer = (map: MapLibreMap, prefix: string) => {
  let shown = new Map<string, ItemFeatures>();
  let started = false;
  return (
    items: TakItem[],
    hidden: ReadonlySet<string>,
    now: number,
    bearing: number,
  ): { graphicsPending: boolean } => {
    const drawn = pictureOf(map, items, hidden, now, bearing, true);
    pruneTactical();
    pruneLabels(map);
    const source = (name: SourceName) => geoJsonSource(map, `${prefix}-${name}`);
    if (!started) {
      started = true;
      for (const name of SOURCE_NAMES) {
        source(name).setData(
          collection([...drawn].flatMap(([uid, features]) => withIds(uid, features[name]))),
        );
      }
    } else {
      for (const name of SOURCE_NAMES) {
        const diff = sourceDiff(shown, drawn, name);
        if (diff.remove.length || diff.add.length) void source(name).updateData(diff);
      }
    }
    shown = drawn;
    return { graphicsPending: [...drawn.values()].some((f) => f.pending) };
  };
};
