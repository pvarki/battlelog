import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import {
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
} from "maplibre-gl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ACCENT } from "../../theme.ts";
import type { Position, TakItem } from "../cot.ts";
import type { Drawn, Sketch } from "../drawing/useDrawing.ts";
import { labelOf } from "../items.ts";
import type { MapView } from "../tools.ts";
import { useNow } from "../use-now.ts";
import type { MapSource } from "./basemaps.ts";
import { type Cursor, useCursor } from "./cursor.ts";
import { onIconsetsChanged } from "./iconsets.ts";
import { type ScreenPoint, uidsInOutline } from "./lasso.ts";
import { LABEL_ZOOM_FILTER, toSources } from "./layers.ts";
import { mgrsGrid } from "./mgrs-grid.ts";
import { labelImage } from "./symbols.ts";
import { addTacticalLayers, onTacticalRendered } from "./tactical.ts";

type Props = {
  items: TakItem[];
  /** Where the pointer is on this map. */
  cursor: Cursor;
  /** What's being drawn, in its final look, on its own layers: the pointer moving it redraws only that. */
  preview?: {
    sketch: Sketch;
    build: (sketch: Drawn | undefined, cursor: Position | undefined) => TakItem[];
  };
  /** Breadcrumb trails, from `trackFeatures`. */
  tracks: FeatureCollection;
  hidden: ReadonlySet<string>;
  basemap: MapSource;
  /** A second map drawn see-through over the background, like orthophoto over topographic. */
  overlay?: { source: MapSource; opacity: number };
  /** Night use: the bright MML maps glare next to a dark UI. */
  dim: boolean;
  mgrsGrid: boolean;
  selectedUids: readonly string[];
  /** Every item under a click, topmost first, where on the screen and map it was, and whether Shift was held. */
  onPick: (pick: {
    uids: string[];
    at: { x: number; y: number };
    position: Position;
    shift: boolean;
  }) => void;
  /** Shift-dragging draws a box and picks every item in it; without this, Shift-drag zooms. */
  onBoxSelect?: (uids: string[]) => void;
  /** While set, dragging draws a lasso (mouse or finger) instead of panning, and hands over the items inside. */
  onLasso?: (uids: string[]) => void;
  onReady: (map: MapLibreMap | undefined) => void;
  /** A fixed starting view; the map then doesn't remember where the viewer left it. */
  view?: MapView;
  /** A wall display: no hover names, and clicks pick nothing. */
  passive?: boolean;
  /** Icons and their labels, larger for reading from across a room. */
  symbolScale?: number;
  /** The moment shown when replaying history, which staleness is judged at; undefined when live. */
  replayAt?: number;
};

const VIEW_KEY = "battlelog.tak.view";

const sameMembers = <T,>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const FINLAND = { center: [25.5, 64] as [number, number], zoom: 4.5, bearing: 0 };
// Fading depends on the clock as well as on data: re-evaluate even when nothing arrives.
const FADE_CHECK_MS = 30_000;
const CLICK_SLACK_PX = 4;
const INTERACTIVE_LAYERS = [
  "tak-points",
  "tak-shape-lines",
  "tak-shape-fills",
  "tak-tactical-labels",
  "tak-tactical-lines",
  "tak-tactical-fills",
];

type ScreenBox = [[number, number], [number, number]];

const uidsIn = (map: MapLibreMap, box: ScreenBox) => [
  ...new Set(
    map
      .queryRenderedFeatures(box, { layers: INTERACTIVE_LAYERS })
      .flatMap((f) => (f.properties?.uid ? [f.properties.uid as string] : [])),
  ),
];

// A few pixels of slack: thin lines are otherwise nearly impossible to hit.
const uidsAt = (map: MapLibreMap, { x, y }: { x: number; y: number }) =>
  uidsIn(map, [
    [x - CLICK_SLACK_PX, y - CLICK_SLACK_PX],
    [x + CLICK_SLACK_PX, y + CLICK_SLACK_PX],
  ]);

/** Draws a box from `start` while the pointer drags, then hands over the items inside it. */
const dragSelectBox = (
  map: MapLibreMap,
  start: { x: number; y: number },
  onSelect: (uids: string[]) => void,
) => {
  const container = map.getContainer();
  const outline = document.createElement("div");
  outline.className = "tak-select-box";
  container.appendChild(outline);
  let box: ScreenBox = [
    [start.x, start.y],
    [start.x, start.y],
  ];
  const onMove = (e: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    const [x, y] = [e.clientX - rect.left, e.clientY - rect.top];
    box = [
      [Math.min(start.x, x), Math.min(start.y, y)],
      [Math.max(start.x, x), Math.max(start.y, y)],
    ];
    Object.assign(outline.style, {
      left: `${box[0][0]}px`,
      top: `${box[0][1]}px`,
      width: `${box[1][0] - box[0][0]}px`,
      height: `${box[1][1] - box[0][1]}px`,
    });
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    outline.remove();
    const [[left, top], [right, bottom]] = box;
    if (right - left > CLICK_SLACK_PX || bottom - top > CLICK_SLACK_PX) onSelect(uidsIn(map, box));
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};

const LASSO_STEP_PX = 3;

/** Lasso mode: pointer drags draw an outline instead of panning; returns the cleanup. */
const followLasso = (map: MapLibreMap, onSelect: (uids: string[]) => void) => {
  const container = map.getCanvasContainer();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("tak-lasso");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  svg.appendChild(line);
  map.getContainer().appendChild(svg);
  map.dragPan.disable();
  container.style.cursor = "crosshair";
  let outline: ScreenPoint[] | undefined;

  const pointOf = (e: PointerEvent): ScreenPoint => {
    const rect = container.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  const draw = () => line.setAttribute("points", (outline ?? []).map((p) => p.join(",")).join(" "));
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    outline = [pointOf(e)];
    draw();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };
  const onMove = (e: PointerEvent) => {
    if (!outline) return;
    const [x, y] = pointOf(e);
    const [lx, ly] = outline.at(-1) as ScreenPoint;
    if (Math.hypot(x - lx, y - ly) < LASSO_STEP_PX) return;
    outline.push([x, y]);
    draw();
  };
  const onUp = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    const drawn = outline;
    outline = undefined;
    draw();
    if (!drawn || drawn.length < 3) return;
    const xs = drawn.map(([x]) => x);
    const ys = drawn.map(([, y]) => y);
    const features = map.queryRenderedFeatures(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      { layers: INTERACTIVE_LAYERS },
    );
    onSelect(uidsInOutline(map, features, drawn));
  };
  container.addEventListener("pointerdown", onDown);
  return () => {
    container.removeEventListener("pointerdown", onDown);
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    svg.remove();
    container.style.cursor = "";
    map.dragPan.enable();
  };
};

const savedView = () => {
  try {
    return { ...FINLAND, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") };
  } catch {
    return FINLAND;
  }
};

export const viewOf = (map: MapLibreMap): MapView => {
  const { lng, lat } = map.getCenter();
  return { center: [lng, lat], zoom: map.getZoom(), bearing: map.getBearing() };
};

const saveView = (map: MapLibreMap) => {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(viewOf(map)));
  } catch {
    // storage denied: the next visit starts from the default view
  }
};

const shownRasters = new WeakMap<MapLibreMap, Map<string, string>>();

/** Puts `source` on the raster layer `id` (or takes it off), keeping basemap below overlay below the rest. */
const showRaster = (map: MapLibreMap, id: "basemap" | "overlay", source: MapSource | undefined) => {
  const shown = shownRasters.get(map) ?? new Map<string, string>();
  shownRasters.set(map, shown);
  const key = source ? JSON.stringify(source.spec) : "";
  if (shown.get(id) === key) return;
  shown.set(id, key);
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
  if (!source) return;
  map.addSource(id, source.spec);
  const layers = map.getStyle().layers.map((l) => l.id);
  const below = id === "basemap" ? layers[0] : layers[layers.indexOf("basemap") + 1];
  map.addLayer({ id, type: "raster", source: id }, below);
};

const ITEM_SOURCES = [
  "points",
  "shapes",
  "markerLabels",
  "lineLabels",
  "decorations",
  "tactical",
] as const;

// ATAK's dash patterns (6 on / 10 off, 2 on / 14 off) in line-width units for a typical 3–4 px line.
const DASHES: ExpressionSpecification = [
  "match",
  ["get", "strokeStyle"],
  "dashed",
  ["literal", [4, 6]],
  "dotted",
  ["literal", [1, 4]],
  ["literal", [1, 0]],
];

const empty = { type: "FeatureCollection" as const, features: [] };

const addTrackLayers = (map: MapLibreMap) => {
  map.addSource("tak-tracks", { type: "geojson", data: empty });
  map.addLayer({
    id: "tak-track-lines",
    type: "line",
    source: "tak-tracks",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": ["get", "color"], "line-width": 2, "line-opacity": 0.8 },
  });
  map.addLayer({
    id: "tak-track-crumbs",
    type: "circle",
    source: "tak-tracks",
    filter: ["!=", ["geometry-type"], "LineString"],
    paint: {
      "circle-radius": 2.5,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#000000",
      "circle-stroke-width": 0.5,
    },
  });
};

const addMgrsGridLayers = (map: MapLibreMap) => {
  map.addSource("mgrs-grid", { type: "geojson", data: empty });
  const lines = {
    type: "line" as const,
    source: "mgrs-grid",
    filter: ["has", "level"] as FilterSpecification,
  };
  const width: ExpressionSpecification = ["match", ["get", "level"], "gzd", 2, "100km", 1.5, 1];
  map.addLayer({
    ...lines,
    id: "mgrs-grid-casings",
    paint: { "line-color": "#000000", "line-opacity": 0.5, "line-width": ["+", width, 1.5] },
  });
  map.addLayer({
    ...lines,
    id: "mgrs-grid-lines",
    paint: { "line-color": "#ffffff", "line-width": width },
  });
  map.addLayer({
    id: "mgrs-grid-labels",
    type: "symbol",
    source: "mgrs-grid",
    filter: ["has", "text"],
    layout: { "icon-image": ["get", "icon"], "icon-anchor": ["get", "anchor"] },
  });
};

/** Redraws the grid for the viewport after every move; returns how to stop. */
const followMgrsGrid = (map: MapLibreMap) => {
  const source = map.getSource("mgrs-grid") as GeoJSONSource;
  const draw = () => {
    const bounds = map.getBounds();
    const grid = mgrsGrid(
      {
        west: Math.max(bounds.getWest(), -180),
        south: bounds.getSouth(),
        east: Math.min(bounds.getEast(), 180),
        north: bounds.getNorth(),
      },
      map.getZoom(),
    );
    for (const { properties } of grid.features) {
      if (properties?.text) properties.icon = labelImage(map, properties.text).id;
    }
    source.setData(grid);
  };
  draw();
  map.on("moveend", draw);
  return () => {
    map.off("moveend", draw);
  };
};

/** The item layers over sources named `${prefix}-…`: "tak" for the picture, "tak-preview" for what's being drawn. */
const addItemLayers = (map: MapLibreMap, prefix: string) => {
  for (const name of ITEM_SOURCES) {
    if (name !== "tactical") map.addSource(`${prefix}-${name}`, { type: "geojson", data: empty });
  }
  const overlapping = { "icon-allow-overlap": true, "icon-ignore-placement": true } as const;
  map.addLayer({
    id: `${prefix}-shape-fills`,
    type: "fill",
    source: `${prefix}-shapes`,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": ["get", "fill"], "fill-opacity": ["get", "fillOpacity"] },
  });
  map.addLayer({
    id: `${prefix}-draft-shapes`,
    type: "line",
    source: `${prefix}-shapes`,
    filter: ["==", ["get", "draft"], true],
    paint: {
      "line-color": ACCENT,
      "line-width": ["+", ["get", "strokeWidth"], 6],
      "line-opacity": 0.7,
      "line-dasharray": ["literal", [1, 1]],
    },
  });
  map.addLayer({
    id: `${prefix}-shape-casings`,
    type: "line",
    source: `${prefix}-shapes`,
    filter: ["==", ["get", "strokeStyle"], "outlined"],
    paint: { "line-color": "#000000", "line-width": ["+", ["get", "strokeWidth"], 2] },
  });
  map.addLayer({
    id: `${prefix}-shape-lines`,
    type: "line",
    source: `${prefix}-shapes`,
    paint: {
      "line-color": ["get", "stroke"],
      "line-width": ["get", "strokeWidth"],
      "line-opacity": ["get", "strokeOpacity"],
      "line-dasharray": DASHES,
    },
  });
  map.addLayer({
    id: `${prefix}-selected-shape`,
    type: "line",
    source: `${prefix}-shapes`,
    filter: ["==", ["get", "uid"], ""],
    paint: { "line-color": ACCENT, "line-width": 6, "line-opacity": 0.6 },
  });
  if (prefix === "tak") addTrackLayers(map);
  addTacticalLayers(map, prefix);
  map.addLayer({
    id: `${prefix}-selected-tactical`,
    type: "line",
    source: `${prefix}-tactical`,
    filter: ["==", ["get", "uid"], ""],
    paint: { "line-color": ACCENT, "line-width": 6, "line-opacity": 0.6 },
  });
  map.addLayer({
    id: `${prefix}-decorations`,
    type: "symbol",
    source: `${prefix}-decorations`,
    layout: {
      ...overlapping,
      "icon-image": ["get", "icon"],
      "icon-offset": ["get", "offset"],
      "icon-rotate": ["get", "rotate"],
      "icon-rotation-alignment": "map",
    },
  });
  map.addLayer({
    id: `${prefix}-line-labels`,
    type: "symbol",
    source: `${prefix}-lineLabels`,
    filter: LABEL_ZOOM_FILTER,
    layout: {
      ...overlapping,
      "icon-image": ["get", "icon"],
      "icon-rotate": ["get", "rotate"],
      "icon-rotation-alignment": "map",
    },
  });
  map.addLayer({
    id: `${prefix}-draft-points`,
    type: "circle",
    source: `${prefix}-points`,
    filter: ["==", ["get", "draft"], true],
    paint: {
      "circle-radius": 15,
      "circle-color": "transparent",
      "circle-stroke-color": ACCENT,
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.8,
    },
  });
  map.addLayer({
    id: `${prefix}-selected-point`,
    type: "circle",
    source: `${prefix}-points`,
    filter: ["==", ["get", "uid"], ""],
    paint: {
      "circle-radius": 18,
      "circle-color": "transparent",
      "circle-stroke-color": ACCENT,
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: `${prefix}-points`,
    type: "symbol",
    source: `${prefix}-points`,
    layout: {
      ...overlapping,
      "icon-image": ["get", "icon"],
      "icon-offset": ["get", "offset"],
      "symbol-sort-key": ["get", "order"],
    },
  });
  map.addLayer({
    id: `${prefix}-marker-labels`,
    type: "symbol",
    source: `${prefix}-markerLabels`,
    filter: LABEL_ZOOM_FILTER,
    layout: { ...overlapping, "icon-image": ["get", "icon"], "icon-offset": ["get", "offset"] },
  });
};

/** The MapLibre map: basemap, TAK items, selection, hover names and the cursor position. */
export const MapCanvas = ({
  items,
  preview,
  cursor,
  tracks,
  hidden,
  basemap,
  overlay,
  dim,
  mgrsGrid: showMgrsGrid,
  selectedUids,
  onPick,
  onBoxSelect,
  onLasso,
  onReady,
  view,
  passive = false,
  symbolScale = 1,
  replayAt,
}: Props) => {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap>();
  const liveNow = useNow(FADE_CHECK_MS);
  const now = replayAt ?? liveNow;
  const [bearing, setBearing] = useState(0);
  const itemsByUid = useRef(new Map<string, TakItem>());
  itemsByUid.current = new Map(items.map((i) => [i.uid, i]));
  const callbacks = useRef({ onPick, onBoxSelect, onReady, passive, cursor });
  callbacks.current = { onPick, onBoxSelect, onReady, passive, cursor };
  // The map is created once; pinning a new view applies on the next open.
  const startView = useRef(view);

  useEffect(() => {
    const m = new MapLibreMap({
      container: container.current as HTMLDivElement,
      style: { version: 8, sources: {}, layers: [] },
      ...(startView.current ?? savedView()),
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    m.keyboard.enable();

    const hover = new Popup({ closeButton: false, closeOnClick: false, offset: 14 });

    m.on("load", () => {
      addMgrsGridLayers(m);
      addItemLayers(m, "tak");
      addItemLayers(m, "tak-preview");
      setMap(m);
      setBearing(m.getBearing());
      callbacks.current.onReady(m);
    });
    if (!startView.current) m.on("moveend", () => saveView(m));
    m.on("rotateend", () => setBearing(m.getBearing()));
    m.on("click", (e) => {
      if (callbacks.current.passive) return;
      callbacks.current.onPick({
        uids: uidsAt(m, e.point),
        at: e.point,
        position: [e.lngLat.lng, e.lngLat.lat],
        shift: e.originalEvent.shiftKey,
      });
    });
    m.on("mousedown", (e) => {
      const { onBoxSelect, passive } = callbacks.current;
      if (passive || !onBoxSelect || !e.originalEvent.shiftKey || e.originalEvent.button !== 0)
        return;
      // Keeps MapLibre's own Shift-drag (box zoom) and panning out of it.
      e.preventDefault();
      dragSelectBox(m, e.point, onBoxSelect);
    });
    m.on("mousemove", (e) => {
      callbacks.current.cursor.set([e.lngLat.lng, e.lngLat.lat]);
      const uid = callbacks.current.passive ? undefined : uidsAt(m, e.point)[0];
      const item = uid ? itemsByUid.current.get(uid) : undefined;
      m.getCanvas().style.cursor = item ? "pointer" : "";
      if (!item) {
        hover.remove();
        return;
      }
      const label = document.createElement("span");
      label.textContent = labelOf(item);
      hover.setLngLat(e.lngLat).setDOMContent(label).addTo(m);
    });
    m.on("mouseout", () => {
      callbacks.current.cursor.set(undefined);
      hover.remove();
    });

    return () => {
      callbacks.current.onReady(undefined);
      m.remove();
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    showRaster(map, "basemap", basemap);
    showRaster(map, "overlay", overlay?.source);
    for (const id of ["basemap", "overlay"]) {
      if (!map.getLayer(id)) continue;
      map.setPaintProperty(id, "raster-brightness-max", dim ? 0.55 : 1);
      map.setPaintProperty(id, "raster-saturation", dim ? -0.4 : 0);
    }
    if (overlay) map.setPaintProperty("overlay", "raster-opacity", overlay.opacity);
  }, [map, basemap, overlay, dim]);

  const lassoing = !!onLasso;
  const lassoCallback = useRef(onLasso);
  lassoCallback.current = onLasso;
  useEffect(() => {
    if (!map || !lassoing) return;
    return followLasso(map, (uids) => lassoCallback.current?.(uids));
  }, [map, lassoing]);

  useEffect(() => {
    if (!map) return;
    if (showMgrsGrid) return followMgrsGrid(map);
    (map.getSource("mgrs-grid") as GeoJSONSource).setData(empty);
  }, [map, showMgrsGrid]);

  // What the picture was last drawn from. Every upload makes MapLibre's worker re-tile the
  // whole picture, so a render that changed nothing on the map must not reach it.
  const drawnFrom = useRef<{
    items: TakItem[];
    hidden: ReadonlySet<string>;
    now: number;
    bearing: number;
  }>(undefined);
  const awaitingGraphics = useRef(false);

  useEffect(() => {
    if (!map) return;
    // ponytail: full setData per change (≤4/s); switch to updateData diffs if large pictures stutter.
    const draw = () => {
      const sources = toSources(map, items, hidden, now, bearing);
      for (const name of ITEM_SOURCES) {
        (map.getSource(`tak-${name}`) as GeoJSONSource).setData(sources[name]);
      }
      drawnFrom.current = { items, hidden, now, bearing };
      awaitingGraphics.current = sources.graphicsPending;
    };
    const last = drawnFrom.current;
    const unchanged =
      last &&
      last.now === now &&
      last.bearing === bearing &&
      sameMembers(last.items, items) &&
      sameMembers([...last.hidden], [...hidden]);
    // A redraw re-tiles the whole picture; mid-drag that costs frames, so it waits for the map to stop.
    let waiting = false;
    const drawWhenStill = () => {
      if (!map.isMoving()) {
        waiting = false;
        draw();
      } else if (!waiting) {
        waiting = true;
        map.once("moveend", drawWhenStill);
      }
    };
    if (!unchanged) drawWhenStill();
    // Graphics and icon-set icons load asynchronously the first time; redraw when they're ready.
    const offTactical = onTacticalRendered(() => {
      if (awaitingGraphics.current) drawWhenStill();
    });
    const offIconsets = onIconsetsChanged(drawWhenStill);
    return () => {
      map.off("moveend", drawWhenStill);
      offTactical();
      offIconsets();
    };
  }, [map, items, hidden, now, bearing]);

  useEffect(() => {
    if (!map) return;
    for (const layer of map.getStyle().layers) {
      if (layer.type === "symbol" && layer.id.startsWith("tak-"))
        map.setLayoutProperty(layer.id, "icon-size", symbolScale);
    }
  }, [map, symbolScale]);

  const drawnTracks = useRef("");
  useEffect(() => {
    const json = JSON.stringify(tracks);
    if (!map || json === drawnTracks.current) return;
    drawnTracks.current = json;
    (map.getSource("tak-tracks") as GeoJSONSource).setData(tracks);
  }, [map, tracks]);

  // A new array each render; the filter changes only when its members do.
  const selectedKey = JSON.stringify(selectedUids);
  useEffect(() => {
    if (!map) return;
    const uids: string[] = JSON.parse(selectedKey);
    const filter = ["in", ["get", "uid"], ["literal", uids]] as FilterSpecification;
    map.setFilter("tak-selected-point", filter);
    map.setFilter("tak-selected-shape", filter);
    map.setFilter("tak-selected-tactical", filter);
  }, [map, selectedKey]);

  return (
    <>
      <div ref={container} className="tak-map" aria-label="TAK map" role="application" />
      {map && preview && <PreviewLayer map={map} bearing={bearing} cursor={cursor} {...preview} />}
    </>
  );
};

const NO_GROUPS_HIDDEN = new Set<string>();

const PreviewLayer = ({
  map,
  bearing,
  cursor,
  sketch,
  build,
}: { map: MapLibreMap; bearing: number; cursor: Cursor } & NonNullable<Props["preview"]>) => {
  const shape = useSyncExternalStore(sketch.subscribe, sketch.get);
  const items = build(shape, useCursor(cursor));
  useEffect(() => {
    const draw = () => {
      const sources = toSources(map, items, NO_GROUPS_HIDDEN, Date.now(), bearing, false);
      // Until its graphic is rendered, keep showing the last one rather than flicker to a plain line.
      if (sources.graphicsPending) return;
      for (const name of ITEM_SOURCES) {
        (map.getSource(`tak-preview-${name}`) as GeoJSONSource).setData(sources[name]);
      }
    };
    draw();
    return onTacticalRendered(draw);
  }, [map, items, bearing]);
  return null;
};
