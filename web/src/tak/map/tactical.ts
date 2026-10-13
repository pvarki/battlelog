import type { Feature, Geometry, LineString, Polygon } from "geojson";
import type { ExpressionSpecification, FilterSpecification, Map as MapLibreMap } from "maplibre-gl";
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

const RENDERED_AS: Record<Shape["type"], string> = { LineString: "Line", Polygon: "Area" };
// Long side of the virtual canvas the graphic is laid out on: tick marks and
// label spacing scale with the drawing, so it renders once rather than per zoom.
const LAYOUT_PX = 1024;
const MAX_CACHED = 2000;
const LABEL_FONT = "600 12px 'Inter Variable', Inter, system-ui, sans-serif";
const LABEL_HEIGHT = 18;
const LABEL_PADDING = 4;

/** The renderer's control points: a polygon ring without its closing point. */
const controlPoints = (shape: Shape): Position[] =>
  shape.type === "LineString"
    ? (shape.coordinates as Position[])
    : ((shape.coordinates[0] ?? []) as Position[]).slice(0, -1);

/**
 * The 2525D code to render, or undefined when the graphic doesn't fit the
 * drawing: ATAK lets a line graphic sit on a rectangle, which stays plain.
 */
export const symbolFor = (R: Renderer, sidc: string, shape: Shape): string | undefined => {
  const code = sidc.length === 15 ? R.C2DLookup.getInstance().getDCode(sidc) : sidc;
  const info = code ? R.MSLookup.getInstance().getMSLInfo(code) : undefined;
  if (!info || info.getGeometry() !== RENDERED_AS[shape.type]) return undefined;
  const points = controlPoints(shape).length;
  if (points < info.getMinPointCount() || points > info.getMaxPointCount()) return undefined;
  return code;
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
  const code = symbolFor(R, item.sidc, shape);
  if (!code) return undefined;
  const { width, height, bbox } = viewport(controlPoints(shape));
  const modifiers = new Map<string, string>();
  if (item.callsign) modifiers.set(R.Modifiers.T_UNIQUE_DESIGNATION_1, item.callsign);
  const attributes = new Map<string, string>();
  if (item.stroke) attributes.set(R.MilStdAttributes.LineColor, item.stroke.color);
  if (item.strokeWidth) attributes.set(R.MilStdAttributes.LineWidth, String(item.strokeWidth));
  const out = JSON.parse(
    R.WebRenderer.RenderSymbol2D(
      "",
      "",
      "",
      code,
      controlPoints(shape)
        .map(([lon, lat]) => `${lon},${lat}`)
        .join(" "),
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
  if (shape.type === "Polygon") {
    // The area itself, in the fill the user chose, keeps its inside clickable.
    features.unshift({
      type: "Feature",
      geometry: shape,
      properties: { fill: item.fill?.color ?? "#ffffff", fillOpacity: item.fill?.opacity ?? 0 },
    });
  }
  return features;
};

let renderer: Promise<Renderer> | undefined;
// Insertion order is recency: hits are re-inserted, the oldest go first. null = renders plain.
const graphics = new Map<string, Feature[] | null>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
// ponytail: decoded images are never evicted; renderer patterns and icons are a small fixed set.
const imageIds = new Map<string, string>();
const decoded = new Map<string, HTMLImageElement>();

const keyOf = (item: TakItem) =>
  [item.sidc, item.callsign, item.stroke?.color, item.strokeWidth, JSON.stringify(item.geometry)]
    .map(String)
    .join("|");

const loadImage = async (uri: string): Promise<string> => {
  const known = imageIds.get(uri);
  if (known) return known;
  const image = new Image();
  image.src = uri;
  await image.decode();
  const id = `tak-tactical-image-${imageIds.size}`;
  imageIds.set(uri, id);
  decoded.set(id, image);
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

const remember = (key: string, graphic: Feature[] | null) => {
  graphics.delete(key);
  graphics.set(key, graphic);
  if (graphics.size > MAX_CACHED) graphics.delete(graphics.keys().next().value as string);
};

const prepare = async (key: string, item: TakItem) => {
  pending.add(key);
  try {
    renderer ??= import("@armyc2.c5isr.renderer/mil-sym-ts-web");
    const features = renderGraphic(await renderer, item);
    remember(key, features ? await withImageIds(features) : null);
  } catch (err) {
    console.error("Tactical graphic failed to render", err);
    // Stays plain until the drawing changes; a failed chunk load is retried then.
    renderer = undefined;
    remember(key, null);
  } finally {
    pending.delete(key);
    for (const listener of listeners) listener();
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
  faded: boolean,
): Feature[] | undefined => {
  if (!item.sidc || item.geometry.type === "Point") return undefined;
  const key = keyOf(item);
  const graphic = graphics.get(key);
  if (graphic === undefined) {
    if (!pending.has(key)) void prepare(key, item);
    return undefined;
  }
  remember(key, graphic);
  return graphic?.map((f) => ({
    ...f,
    properties: { ...register(map, f.properties as Properties), uid: item.uid, faded },
  }));
};

/** Source and layers for the graphics, drawn over plain shapes and under points. */
export const addTacticalLayers = (map: MapLibreMap) => {
  map.addSource("tak-tactical", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  const faded: ExpressionSpecification = ["case", ["get", "faded"], 0.45, 1];
  const isArea: FilterSpecification = ["==", ["geometry-type"], "Polygon"];
  map.addLayer({
    id: "tak-tactical-fills",
    type: "fill",
    source: "tak-tactical",
    filter: ["all", isArea, ["has", "fill"]],
    paint: { "fill-color": ["get", "fill"], "fill-opacity": ["*", ["get", "fillOpacity"], faded] },
  });
  map.addLayer({
    id: "tak-tactical-patterns",
    type: "fill",
    source: "tak-tactical",
    filter: ["all", isArea, ["has", "pattern"]],
    paint: { "fill-pattern": ["get", "pattern"], "fill-opacity": faded },
  });
  map.addLayer({
    id: "tak-tactical-lines",
    type: "line",
    source: "tak-tactical",
    filter: ["has", "stroke"],
    paint: {
      "line-color": ["get", "stroke"],
      "line-width": ["get", "strokeWidth"],
      "line-opacity": ["*", ["get", "strokeOpacity"], faded],
      "line-dasharray": ["array", "number", ["get", "dash"]],
    },
  });
  map.addLayer({
    id: "tak-tactical-labels",
    type: "symbol",
    source: "tak-tactical",
    filter: ["has", "icon"],
    layout: {
      "icon-image": ["get", "icon"],
      "icon-rotate": ["coalesce", ["get", "angle"], 0],
      "icon-anchor": ["coalesce", ["get", "anchor"], "center"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-opacity": faded },
  });
};
