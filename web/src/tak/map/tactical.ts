import type { Feature, Geometry, LineString, Polygon } from "geojson";
import type { FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
import type { Position, TakItem } from "../cot.ts";

/**
 * MIL-STD-2525 tactical graphics for drawings that carry a `__milsym` code, as
 * ATAK sends them: a plain line or area plus e.g. `G*S*LRM---****X` (main
 * supply route). The renderer is ~9 MB, so it loads only once such a drawing
 * appears; until a graphic is rendered, or when it can't be, the drawing shows
 * as its plain shape.
 */

export type Renderer = typeof import("@armyc2.c5isr.renderer/mil-sym-ts-web");

type Shape = LineString | Polygon;
type Properties = Record<string, unknown>;
type RendererFeature = { geometry: Geometry; properties?: Properties };

// Long side of the virtual canvas the graphic is laid out on: tick marks and
// label spacing scale with the drawing, so it renders once rather than per zoom.
const LAYOUT_PX = 1024;
const MAX_CACHED = 2000;
const LABEL_FONT = "600 12px 'Inter Variable', Inter, system-ui, sans-serif";
const LABEL_HEIGHT = 18;
const LABEL_PADDING = 4;

const midpoint = ([lon1, lat1]: Position, [lon2, lat2]: Position): Position => [
  (lon1 + lon2) / 2,
  (lat1 + lat2) / 2,
];

/**
 * The 2525D code and the control points to render it on, or undefined when
 * the graphic doesn't fit the drawing. Follows ATAK: an area graphic takes the
 * ring without its closing point; a line graphic on a closed shape follows the
 * closed outline, except a two-point line on a rectangle, which runs along its
 * centre line (corner 3–2 midpoint to corner 1–0 midpoint).
 */
export const placementFor = (
  R: Renderer,
  sidc: string,
  shape: Shape,
): { code: string; points: Position[] } | undefined => {
  const code = sidc.length === 15 ? R.C2DLookup.getInstance().getDCode(sidc) : sidc;
  const info = code ? R.MSLookup.getInstance().getMSLInfo(code) : undefined;
  if (!code || !info) return undefined;
  const ring = shape.type === "Polygon" ? ((shape.coordinates[0] ?? []) as Position[]) : undefined;
  let points: Position[];
  if (info.getGeometry() === "Area") {
    if (!ring) return undefined;
    points = ring.slice(0, -1);
  } else if (info.getGeometry() === "Line") {
    if (!ring) points = shape.coordinates as Position[];
    else if (info.getMaxPointCount() === 2 && ring.length === 5) {
      const [c0, c1, c2, c3] = ring as [Position, Position, Position, Position];
      points = [midpoint(c3, c2), midpoint(c1, c0)];
    } else points = ring;
  } else return undefined;
  if (points.length < info.getMinPointCount() || points.length > info.getMaxPointCount())
    return undefined;
  return { code, points };
};

/** The drawing's bounding box plus 10 %, as a canvas of the same aspect. */
const viewport = (points: Position[]) => {
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const [west, east] = [Math.min(...lons), Math.max(...lons)];
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  const pad = Math.max(east - west, north - south, 1e-4) * 0.1;
  const lonScale = Math.cos((((north + south) / 2) * Math.PI) / 180);
  const width = (east - west + 2 * pad) * lonScale;
  const height = north - south + 2 * pad;
  const scale = LAYOUT_PX / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    bbox: [west - pad, south - pad, east + pad, north + pad].join(","),
  };
};

/** A label rotation that never reads upside down; the alignment flips with the text. */
export const upright = (angle: number, align: string): { angle: number; anchor: string } => {
  const a = ((((angle + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(a) <= 90) return { angle: a, anchor: align };
  const flipped = align === "left" ? "right" : align === "right" ? "left" : align;
  return { angle: a > 0 ? a - 180 : a + 180, anchor: flipped };
};

const shapeProperties = (p: Properties): Properties | undefined => {
  const out: Properties = {};
  if (typeof p.strokeColor === "string") {
    const width = Number(p.strokeWidth) || 3;
    out.stroke = p.strokeColor;
    out.strokeOpacity = p.lineOpacity ?? 1;
    out.strokeWidth = width;
    // The renderer dashes in pixels, MapLibre in line widths.
    out.dash = Array.isArray(p.strokeDasharray)
      ? p.strokeDasharray.map((d) => Number(d) / width)
      : [1, 0];
  }
  if (typeof p.fillColor === "string") {
    out.fill = p.fillColor;
    out.fillOpacity = p.fillOpacity ?? 1;
  }
  if (typeof p.fillPattern === "string") out.pattern = p.fillPattern;
  // Without any of these it is the renderer's own bounds polygon.
  return Object.keys(out).length > 0 ? out : undefined;
};

const pointProperties = (p: Properties): Properties | undefined => {
  if (typeof p.image === "string") return { image: p.image, angle: Number(p.angle) || 0 };
  const label = String(p.label ?? "").trim();
  // An unset modifier still comes with its caption, e.g. "TIME FROM:".
  if (!label || label.endsWith(":")) return undefined;
  return { label, ...upright(Number(p.angle) || 0, String(p.labelAlign ?? "center")) };
};

/**
 * The renderer's styled features as map features. Image points and fill
 * patterns keep their data URIs in `image` / `pattern` until registered.
 */
export const toFeatures = (rendered: RendererFeature[]): Feature[] =>
  rendered.flatMap(({ geometry, properties = {} }) => {
    const props =
      geometry.type === "Point" ? pointProperties(properties) : shapeProperties(properties);
    return props ? [{ type: "Feature" as const, geometry, properties: props }] : [];
  });

/** The item drawn as its tactical graphic, or undefined when it has none. */
export const renderGraphic = (R: Renderer, item: TakItem): Feature[] | undefined => {
  const shape = item.geometry;
  if (!item.sidc || shape.type === "Point") return undefined;
  const placement = placementFor(R, item.sidc, shape);
  if (!placement) return undefined;
  const { code, points } = placement;
  const { width, height, bbox } = viewport(points);
  // The renderer reads the attributes (colours) only when there are modifiers, so
  // the name is always set, empty when the drawing's label switch is off.
  const modifiers = new Map<string, string>([
    [R.Modifiers.T_UNIQUE_DESIGNATION_1, item.labelsOn ? (item.callsign ?? "") : ""],
  ]);
  const attributes = new Map<string, string>();
  if (item.stroke) attributes.set(R.MilStdAttributes.LineColor, item.stroke.color);
  if (item.strokeWidth) attributes.set(R.MilStdAttributes.LineWidth, String(item.strokeWidth));
  const out = JSON.parse(
    R.WebRenderer.RenderSymbol2D(
      "",
      "",
      "",
      code,
      points.map(([lon, lat]) => `${lon},${lat}`).join(" "),
      width,
      height,
      bbox,
      modifiers,
      attributes,
      R.WebRenderer.OUTPUT_FORMAT_GEOJSON,
    ),
  ) as { type: string; features?: RendererFeature[] };
  if (out.type === "error" || !out.features) return undefined;
  const features = toFeatures(out.features);
  // The renderer forces 2525D's green on obstacles; ATAK keeps the drawing's colour.
  if (item.stroke && item.sidc[2] === "M") {
    for (const f of features) if (f.properties?.stroke) f.properties.stroke = item.stroke.color;
  }
  if (shape.type === "Polygon") {
    // ATAK shows only the graphic, not the drawing's fill; the invisible area keeps its inside clickable.
    features.unshift({
      type: "Feature",
      geometry: shape,
      properties: { fill: "#000000", fillOpacity: 0 },
    });
  }
  return features;
};

let renderer: Promise<Renderer> | undefined;
// null = renders plain. Entries drawn in the latest redraw are never evicted, so a
// picture bigger than the cap can't evict and re-render its own graphics forever.
const graphics = new Map<string, Feature[] | null>();
const drawn = new Set<string>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
// ponytail: decoded images are never evicted; renderer patterns and icons are a small fixed set.
const imageIds = new Map<string, Promise<string>>();
const decoded = new Map<string, HTMLImageElement>();

const keyOf = (item: TakItem) =>
  [
    item.sidc,
    item.labelsOn && item.callsign,
    item.stroke?.color,
    item.strokeWidth,
    item.fill?.color,
    item.fill?.opacity,
    JSON.stringify(item.geometry),
  ]
    .map(String)
    .join("|");

const decodeImage = async (uri: string, id: string): Promise<string> => {
  const image = new Image();
  image.src = uri;
  await image.decode();
  decoded.set(id, image);
  return id;
};

/** One decode per data URI, even when several renders need it at once. */
const loadImage = (uri: string): Promise<string> => {
  let id = imageIds.get(uri);
  if (!id) {
    id = decodeImage(uri, `tak-tactical-image-${imageIds.size}`);
    imageIds.set(uri, id);
  }
  return id;
};

/** Swaps data URIs for image ids, decoding each image once. */
const withImageIds = (features: Feature[]) =>
  Promise.all(
    features.map(async (f) => {
      const { image, pattern, ...rest } = f.properties as Properties;
      if (typeof image === "string") rest.icon = await loadImage(image);
      if (typeof pattern === "string") rest.pattern = await loadImage(pattern);
      return { ...f, properties: rest };
    }),
  );

/** Whether the item's graphic is ready (or known to render plain), so a redraw would change nothing for it. */
export const tacticalReady = (item: TakItem) =>
  !item.sidc || item.geometry.type === "Point" || graphics.has(keyOf(item));

/** Call after each redraw: forgets graphics that are no longer on the map once over the cap. */
export const pruneTactical = () => {
  if (graphics.size > MAX_CACHED) {
    for (const key of graphics.keys()) if (!drawn.has(key)) graphics.delete(key);
  }
  drawn.clear();
};

// A burst of new drawings finishes rendering one by one; redraw once per batch.
const NOTIFY_DELAY_MS = 250;
let notifyTimer: ReturnType<typeof setTimeout> | undefined;
const notify = () => {
  notifyTimer = undefined;
  for (const listener of listeners) listener();
};

const prepare = async (key: string, item: TakItem) => {
  pending.add(key);
  try {
    renderer ??= import("@armyc2.c5isr.renderer/mil-sym-ts-web");
    const features = renderGraphic(await renderer, item);
    graphics.set(key, features ? await withImageIds(features) : null);
  } catch (err) {
    console.error("Tactical graphic failed to render", err);
    // Stays plain until the drawing changes; a failed chunk load is retried then.
    renderer = undefined;
    graphics.set(key, null);
  } finally {
    pending.delete(key);
    // The last of a batch (or a lone preview while drawing) shows at once.
    if (pending.size === 0) {
      clearTimeout(notifyTimer);
      notify();
    } else if (!notifyTimer) notifyTimer = setTimeout(notify, NOTIFY_DELAY_MS);
  }
};

/** Calls back whenever a graphic finished rendering, so the map can redraw. */
export const onTacticalRendered = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const labelImage = (text: string) => {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.font = LABEL_FONT;
  const width = Math.ceil(ctx.measureText(text).width) + 2 * LABEL_PADDING;
  canvas.width = width * ratio;
  canvas.height = LABEL_HEIGHT * ratio;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, width, LABEL_HEIGHT);
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, LABEL_PADDING, LABEL_HEIGHT / 2);
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height), ratio };
};

/** Registers the images a feature needs with this map, labels drawn on first use. */
const register = (map: MapLibreMap, p: Properties): Properties => {
  if (typeof p.label === "string") {
    const id = `tak-tactical-label:${p.label}`;
    if (!map.hasImage(id)) {
      const { data, ratio } = labelImage(p.label);
      map.addImage(id, data, { pixelRatio: ratio });
    }
    return { ...p, icon: id };
  }
  for (const id of [p.icon, p.pattern]) {
    const image = decoded.get(id as string);
    if (image && !map.hasImage(id as string)) map.addImage(id as string, image);
  }
  return p;
};

/**
 * The item's tactical graphic as map features, or undefined to draw it plain:
 * no graphic, one that doesn't fit, or not rendered yet (the map hears from
 * onTacticalRendered when it is).
 */
export const tacticalFeatures = (
  map: MapLibreMap,
  item: TakItem,
  bearing: number,
): Feature[] | undefined => {
  if (!item.sidc || item.geometry.type === "Point") return undefined;
  const key = keyOf(item);
  const graphic = graphics.get(key);
  if (graphic === undefined) {
    if (!pending.has(key)) void prepare(key, item);
    return undefined;
  }
  drawn.add(key);
  return graphic?.map((f) => {
    const p = register(map, f.properties as Properties);
    if (typeof p.label !== "string") return { ...f, properties: { ...p, uid: item.uid } };
    // Upright on screen: the label turns with the map, so correct for its bearing.
    const turned = upright(Number(p.angle) - bearing, String(p.anchor));
    return {
      ...f,
      properties: { ...p, angle: turned.angle + bearing, anchor: turned.anchor, uid: item.uid },
    };
  });
};

/** Source and layers for the graphics, drawn over plain shapes and under points. */
export const addTacticalLayers = (map: MapLibreMap, prefix: string) => {
  map.addSource(`${prefix}-tactical`, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  const isArea: FilterSpecification = ["==", ["geometry-type"], "Polygon"];
  map.addLayer({
    id: `${prefix}-tactical-fills`,
    type: "fill",
    source: `${prefix}-tactical`,
    filter: ["all", isArea, ["has", "fill"]],
    paint: { "fill-color": ["get", "fill"], "fill-opacity": ["get", "fillOpacity"] },
  });
  map.addLayer({
    id: `${prefix}-tactical-patterns`,
    type: "fill",
    source: `${prefix}-tactical`,
    filter: ["all", isArea, ["has", "pattern"]],
    paint: { "fill-pattern": ["get", "pattern"] },
  });
  map.addLayer({
    id: `${prefix}-tactical-lines`,
    type: "line",
    source: `${prefix}-tactical`,
    filter: ["has", "stroke"],
    paint: {
      "line-color": ["get", "stroke"],
      "line-width": ["get", "strokeWidth"],
      "line-opacity": ["get", "strokeOpacity"],
      "line-dasharray": ["array", "number", ["get", "dash"]],
    },
  });
  map.addLayer({
    id: `${prefix}-tactical-labels`,
    type: "symbol",
    source: `${prefix}-tactical`,
    filter: ["has", "icon"],
    layout: {
      "icon-image": ["get", "icon"],
      "icon-rotate": ["coalesce", ["get", "angle"], 0],
      "icon-anchor": ["coalesce", ["get", "anchor"], "center"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
};
