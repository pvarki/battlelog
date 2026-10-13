import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection } from "geojson";
import {
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  Map as MapLibreMap,
  type MapMouseEvent,
  NavigationControl,
  Popup,
  ScaleControl,
} from "maplibre-gl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Position, TakItem } from "../cot.ts";
import type { Drawn, Sketch } from "../drawing/useDrawing.ts";
import { labelOf } from "../items.ts";
import type { MapView } from "../tools.ts";
import { useNow } from "../use-now.ts";
import { BASEMAPS, type Basemap } from "./basemaps.ts";
import { type Cursor, useCursor } from "./cursor.ts";
import { onIconsetsChanged } from "./iconsets.ts";
import { toSources } from "./layers.ts";
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
  basemap: Basemap;
  /** Night use: the bright MML maps glare next to a dark UI. */
  dim: boolean;
  selectedUid: string | undefined;
  /** Every item under a click, topmost first, and where on the map it was. */
  onPick: (uids: string[], at: { x: number; y: number }) => void;
  onReady: (map: MapLibreMap | undefined) => void;
  /** A fixed starting view; the map then doesn't remember where the viewer left it. */
  view?: MapView;
  /** A wall display: no hover names, and clicks pick nothing. */
  passive?: boolean;
  /** Icons and their labels, larger for reading from across a room. */
  symbolScale?: number;
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
const ACCENT = "#8abbff";
// ATAK hides marker names beyond 10 m per pixel, about zoom 12 at Finnish latitudes.
const MARKER_LABEL_MIN_ZOOM = 12;

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

const shownBasemap = new WeakMap<MapLibreMap, Basemap>();

const showBasemap = (map: MapLibreMap, basemap: Basemap) => {
  if (shownBasemap.get(map) === basemap) return;
  shownBasemap.set(map, basemap);
  const { tiles, attribution, maxzoom } = BASEMAPS[basemap];
  if (map.getLayer("basemap")) map.removeLayer("basemap");
  if (map.getSource("basemap")) map.removeSource("basemap");
  map.addSource("basemap", { type: "raster", tiles: [tiles], tileSize: 256, attribution, maxzoom });
  const firstItemLayer = map.getStyle().layers.find((l) => l.id.startsWith("tak-"))?.id;
  map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, firstItemLayer);
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
    minzoom: MARKER_LABEL_MIN_ZOOM,
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
  dim,
  selectedUid,
  onPick,
  onReady,
  view,
  passive = false,
  symbolScale = 1,
}: Props) => {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap>();
  const now = useNow(FADE_CHECK_MS);
  const [bearing, setBearing] = useState(0);
  const itemsByUid = useRef(new Map<string, TakItem>());
  itemsByUid.current = new Map(items.map((i) => [i.uid, i]));
  const callbacks = useRef({ onPick, onReady, passive, cursor });
  callbacks.current = { onPick, onReady, passive, cursor };
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
    // A few pixels of slack: thin lines are otherwise nearly impossible to hit.
    const uidsAt = (e: MapMouseEvent) => {
      const { x, y } = e.point;
      const hits = m.queryRenderedFeatures(
        [
          [x - CLICK_SLACK_PX, y - CLICK_SLACK_PX],
          [x + CLICK_SLACK_PX, y + CLICK_SLACK_PX],
        ],
        { layers: INTERACTIVE_LAYERS },
      );
      return [
        ...new Set(hits.flatMap((f) => (f.properties?.uid ? [f.properties.uid as string] : []))),
      ];
    };
    const uidAt = (e: MapMouseEvent) => uidsAt(e)[0];

    m.on("load", () => {
      addItemLayers(m, "tak");
      addItemLayers(m, "tak-preview");
      setMap(m);
      setBearing(m.getBearing());
      callbacks.current.onReady(m);
    });
    if (!startView.current) m.on("moveend", () => saveView(m));
    m.on("rotateend", () => setBearing(m.getBearing()));
    m.on("click", (e) => {
      if (!callbacks.current.passive) callbacks.current.onPick(uidsAt(e), e.point);
    });
    m.on("mousemove", (e) => {
      callbacks.current.cursor.set([e.lngLat.lng, e.lngLat.lat]);
      const uid = callbacks.current.passive ? undefined : uidAt(e);
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
    showBasemap(map, basemap);
    map.setPaintProperty("basemap", "raster-brightness-max", dim ? 0.55 : 1);
    map.setPaintProperty("basemap", "raster-saturation", dim ? -0.4 : 0);
  }, [map, basemap, dim]);

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
    if (!unchanged) draw();
    // Graphics and icon-set icons load asynchronously the first time; redraw when they're ready.
    const offTactical = onTacticalRendered(() => {
      if (awaitingGraphics.current) draw();
    });
    const offIconsets = onIconsetsChanged(draw);
    return () => {
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

  useEffect(() => {
    if (!map) return;
    const filter = ["==", ["get", "uid"], selectedUid ?? ""] as FilterSpecification;
    map.setFilter("tak-selected-point", filter);
    map.setFilter("tak-selected-shape", filter);
    map.setFilter("tak-selected-tactical", filter);
  }, [map, selectedUid]);

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
