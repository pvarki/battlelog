import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point } from "geojson";
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
import type { EventFeature } from "../event-layers/layers.ts";
import { labelOf } from "../items.ts";
import type { MapView } from "../tools.ts";
import { useNow } from "../use-now.ts";
import type { MapSource } from "./basemaps.ts";
import { type Cursor, useCursor } from "./cursor.ts";
import { addEventLayers, eventsAt } from "./event-layers.ts";
import { onIconsetsChanged } from "./iconsets.ts";
import { createPictureDrawer, LABEL_ZOOM_FILTER, toSources } from "./layers.ts";
import { mgrsGrid } from "./mgrs-grid.ts";
import { showRasters } from "./rasters.ts";
import { dragSelectBox, followLasso, uidsAt } from "./selection.ts";
import { keptLabelImage, labelImage } from "./symbols.ts";
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
    /** BattleLog events under the click, topmost first. */
    eventIds: string[];
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
  /** BattleLog events drawn above the TAK picture, from `layerFeatures`. */
  events?: FeatureCollection<Point, EventFeature["properties"]>;
  selectedEventId?: string;
};

const VIEW_KEY = "battlelog.tak.view";

const sameMembers = <T,>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const FINLAND = { center: [25.5, 64] as [number, number], zoom: 4.5, bearing: 0 };
// Fading depends on the clock as well as on data: re-evaluate even when nothing arrives.
const FADE_CHECK_MS = 30_000;

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
  events,
  selectedEventId,
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
      addEventLayers(m);
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
        eventIds: eventsAt(m, e.point).map((p) => p.eventId),
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
      const event = !item && !callbacks.current.passive ? eventsAt(m, e.point)[0] : undefined;
      m.getCanvas().style.cursor = item || event ? "pointer" : "";
      if (!item && !event) {
        hover.remove();
        return;
      }
      const label = document.createElement("span");
      label.textContent = item ? labelOf(item) : (event?.label ?? "");
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
    showRasters(map, basemap, overlay, dim);
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

  const drawPicture = useRef<ReturnType<typeof createPictureDrawer>>(undefined);
  useEffect(() => {
    if (!map) return;
    drawPicture.current ??= createPictureDrawer(map, "tak");
    const draw = () => {
      const { graphicsPending } = (drawPicture.current as ReturnType<typeof createPictureDrawer>)(
        items,
        hidden,
        now,
        bearing,
      );
      drawnFrom.current = { items, hidden, now, bearing };
      awaitingGraphics.current = graphicsPending;
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

  const drawnEvents = useRef("");
  useEffect(() => {
    const json = JSON.stringify(events ?? empty);
    if (!map || json === drawnEvents.current) return;
    drawnEvents.current = json;
    const withIcons = {
      ...(events ?? empty),
      features: (events?.features ?? []).map((f) => ({
        ...f,
        properties: { ...f.properties, icon: keptLabelImage(map, f.properties.label).id },
      })),
    };
    (map.getSource("bl-events") as GeoJSONSource).setData(withIcons);
  }, [map, events]);

  useEffect(() => {
    map?.setFilter("bl-selected-event", ["==", ["get", "eventId"], selectedEventId ?? ""]);
  }, [map, selectedEventId]);

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
      const sources = toSources(map, items, NO_GROUPS_HIDDEN, Date.now(), bearing);
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
