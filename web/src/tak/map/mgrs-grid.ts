import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import { forward } from "mgrs";
import proj4 from "proj4";
import type { Position } from "../cot.ts";

/** A longitude/latitude rectangle. */
export type Bounds = { west: number; south: number; east: number; north: number };

export type GridLevel = "gzd" | "100km" | "10km" | "1km" | "100m";

/** Where a label's image sits relative to its point, as MapLibre's `icon-anchor`. */
export type LabelAnchor = "center" | "bottom" | "left";

export type GridFeature =
  | Feature<LineString, { level: GridLevel }>
  | Feature<Point, { text: string; anchor: LabelAnchor }>;

// Each level starts where its lines are 40–80 px apart at Finnish latitudes.
const LEVELS = [
  { level: "100km", metres: 100_000, minZoom: 6 },
  { level: "10km", metres: 10_000, minZoom: 9 },
  { level: "1km", metres: 1_000, minZoom: 12 },
  { level: "100m", metres: 100, minZoom: 15 },
] as const;
type Level = (typeof LEVELS)[number];

const GZD_LABEL_MIN_ZOOM = 3;
const SQUARE = 100_000;
// UTM grid lines curve on a Web Mercator map; this many points per line keeps them on the curve.
const SAMPLES = 32;
// A pitched map can show the horizon; past this many lines per zone the grid is noise anyway.
const MAX_LINES_PER_CELL = 300;

const BANDS = "CDEFGHJKLMNPQRSTUVWX";
/** The zones that differ from the regular 6° pattern: southwest Norway and Svalbard. */
const ZONE_EXCEPTIONS: Record<string, Record<number, [number, number] | null>> = {
  V: { 31: [0, 3], 32: [3, 12] },
  X: { 31: [0, 9], 32: null, 33: [9, 21], 34: null, 35: [21, 33], 36: null, 37: [33, 42] },
};

type Cell = Bounds & { zone: number; band: string };

const gridZones = (): Cell[] =>
  [...BANDS].flatMap((band, i) => {
    const south = -80 + 8 * i;
    const north = band === "X" ? 84 : south + 8;
    return Array.from({ length: 60 }, (_, z) => z + 1).flatMap((zone) => {
      const exception = ZONE_EXCEPTIONS[band]?.[zone];
      if (exception === null) return [];
      const [west, east] = exception ?? [-180 + 6 * (zone - 1), -174 + 6 * (zone - 1)];
      return [{ zone, band, west, south, east, north }];
    });
  });

const GRID_ZONES = gridZones();

const intersect = (a: Bounds, b: Bounds): Bounds | undefined => {
  const r = {
    west: Math.max(a.west, b.west),
    south: Math.max(a.south, b.south),
    east: Math.min(a.east, b.east),
    north: Math.min(a.north, b.north),
  };
  return r.west < r.east && r.south < r.north ? r : undefined;
};

const utm = (zone: number, south: boolean) =>
  proj4("WGS84", `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);

/** The part of segment a→b inside the rectangle (Liang–Barsky), and whether it leaves through the far end. */
const clipSegment = (a: Position, b: Position, r: Bounds) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-dx, a[0] - r.west],
    [dx, r.east - a[0]],
    [-dy, a[1] - r.south],
    [dy, r.north - a[1]],
  ] as const;
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return undefined;
  }
  const at = (t: number): Position => [a[0] + t * dx, a[1] + t * dy];
  return { from: at(t0), to: at(t1), exits: t1 < 1 };
};

export const clipPolyline = (points: Position[], r: Bounds): Position[][] => {
  const pieces: Position[][] = [];
  let piece: Position[] = [];
  const close = () => {
    if (piece.length > 1) pieces.push(piece);
    piece = [];
  };
  for (let i = 1; i < points.length; i++) {
    const segment = clipSegment(points[i - 1] as Position, points[i] as Position, r);
    if (!segment) {
      close();
      continue;
    }
    if (piece.length === 0) piece.push(segment.from);
    piece.push(segment.to);
    if (segment.exits) close();
  }
  close();
  return pieces;
};

const perimeter = (r: Bounds): Position[] =>
  Array.from({ length: SAMPLES + 1 }, (_, i) => i / SAMPLES).flatMap((t): Position[] => {
    const lon = r.west + t * (r.east - r.west);
    const lat = r.south + t * (r.north - r.south);
    return [
      [lon, r.south],
      [lon, r.north],
      [r.west, lat],
      [r.east, lat],
    ];
  });

const multiplesIn = (min: number, max: number, step: number) => {
  const values: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) values.push(v);
  return values;
};

/** The value's digits within its 100 km square, as MGRS writes them at this precision. */
const digits = (value: number, metres: number) =>
  String(Math.round((value % SQUARE) / metres)).padStart(Math.log10(SQUARE / metres), "0");

const line = (coordinates: Position[], level: GridLevel): GridFeature => ({
  type: "Feature",
  geometry: { type: "LineString", coordinates },
  properties: { level },
});

const label = (coordinates: Position, text: string, anchor: LabelAnchor): GridFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates },
  properties: { text, anchor },
});

const inside = ([lon, lat]: Position, r: Bounds) =>
  lon >= r.west && lon <= r.east && lat >= r.south && lat <= r.north;

/** Grid lines and labels of one grid zone, within `r`, the part of it in view. */
const zoneGrid = (cell: Cell, r: Bounds, shown: Level[]): GridFeature[] => {
  const finest = shown.at(-1) as Level;
  const projection = utm(cell.zone, cell.north <= 0);
  const toLonLat = (e: number, n: number) => projection.inverse([e, n]) as Position;
  const projected = perimeter(r).map((p) => projection.forward(p));
  const es = projected.map(([e]) => e as number);
  const ns = projected.map(([, n]) => n as number);
  const [eMin, eMax, nMin, nMax] = [
    Math.min(...es),
    Math.max(...es),
    Math.min(...ns),
    Math.max(...ns),
  ];
  const eastings = multiplesIn(eMin, eMax, finest.metres);
  const northings = multiplesIn(nMin, nMax, finest.metres);
  if (eastings.length + northings.length > MAX_LINES_PER_CELL) return [];

  const levelOf = (value: number) => (shown.find((l) => value % l.metres === 0) ?? finest).level;
  const steps = (min: number, max: number) =>
    Array.from({ length: SAMPLES + 1 }, (_, i) => min + ((max - min) * i) / SAMPLES);
  const labelLines = finest.metres < SQUARE;

  const features: GridFeature[] = [];
  const addLine = (points: Position[], value: number, anchor: LabelAnchor) => {
    const pieces = clipPolyline(points, r);
    features.push(...pieces.map((piece) => line(piece, levelOf(value))));
    const start = pieces[0]?.[0];
    if (labelLines && start) features.push(label(start, digits(value, finest.metres), anchor));
  };
  const eastingLine = (e: number) => steps(nMin, nMax).map((n) => toLonLat(e, n));
  const northingLine = (n: number) => steps(eMin, eMax).map((e) => toLonLat(e, n));
  for (const e of eastings) addLine(eastingLine(e), e, "bottom");
  for (const n of northings) addLine(northingLine(n), n, "left");

  if (shown[0]?.level === "100km") {
    for (const e0 of multiplesIn(eMin - SQUARE, eMax, SQUARE)) {
      for (const n0 of multiplesIn(nMin - SQUARE, nMax, SQUARE)) {
        const e = (Math.max(e0, eMin) + Math.min(e0 + SQUARE, eMax)) / 2;
        const n = (Math.max(n0, nMin) + Math.min(n0 + SQUARE, nMax)) / 2;
        const centre = toLonLat(e, n);
        if (!inside(centre, r)) continue;
        features.push(label(centre, forward(centre, 0).slice(-2), "center"));
      }
    }
  }
  return features;
};

const outline = (c: Bounds): Position[] => [
  [c.west, c.south],
  [c.east, c.south],
  [c.east, c.north],
  [c.west, c.north],
  [c.west, c.south],
];

/**
 * The MGRS grid over a viewport at a zoom, ATAK style: grid zone boundaries always,
 * finer square lines as zooming in, each zone's lines clipped to that zone.
 */
export const mgrsGrid = (view: Bounds, zoom: number): FeatureCollection => {
  const shown = LEVELS.filter((l) => zoom >= l.minZoom);
  const features = GRID_ZONES.flatMap((cell): GridFeature[] => {
    const r = intersect(cell, view);
    if (!r) return [];
    const zoneFeatures = [line(outline(cell), "gzd")];
    if (shown.length > 0) zoneFeatures.push(...zoneGrid(cell, r, shown));
    else if (zoom >= GZD_LABEL_MIN_ZOOM) {
      const centre: Position = [(r.west + r.east) / 2, (r.south + r.north) / 2];
      zoneFeatures.push(label(centre, `${cell.zone}${cell.band}`, "center"));
    }
    return zoneFeatures;
  });
  return { type: "FeatureCollection", features };
};
