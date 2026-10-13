import "maplibre-gl/dist/maplibre-gl.css";
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
import { useEffect, useRef, useState } from "react";
import type { Position, TakItem } from "../cot.ts";
import { type Category, labelOf } from "../items.ts";
import { useNow } from "../use-now.ts";
import { BASEMAPS, type Basemap } from "./basemaps.ts";
import { toSources } from "./layers.ts";
import { addTacticalLayers, onTacticalRendered } from "./tactical.ts";

type Props = {
  items: TakItem[];
  hidden: ReadonlySet<Category>;
  basemap: Basemap;
  /** Night use: the bright MML maps glare next to a dark UI. */
  dim: boolean;
  selectedUid: string | undefined;
  onSelect: (uid: string | undefined) => void;
  onCursor: (position: Position | undefined) => void;
  onReady: (map: MapLibreMap | undefined) => void;
};

const VIEW_KEY = "battlelog.tak.view";
const FINLAND = { center: [25.5, 64] as [number, number], zoom: 4.5, bearing: 0 };
// Fading depends on the clock as well as on data: re-evaluate even when nothing arrives.
const FADE_CHECK_MS = 30_000;
const INTERACTIVE_LAYERS = [
  "tak-points",
  "tak-shape-lines",
  "tak-shape-fills",
  "tak-tactical-labels",
  "tak-tactical-lines",
  "tak-tactical-fills",
];
const ACCENT = "#8abbff";
// Roughly where a town fills the screen and names stop overlapping.
const LABEL_MIN_ZOOM = 11;

const savedView = () => {
  try {
    return { ...FINLAND, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") };
  } catch {
    return FINLAND;
  }
};

const saveView = (map: MapLibreMap) => {
  try {
    const { lng, lat } = map.getCenter();
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ center: [lng, lat], zoom: map.getZoom(), bearing: map.getBearing() }),
    );
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

const addItemLayers = (map: MapLibreMap) => {
  const empty = { type: "FeatureCollection" as const, features: [] };
  map.addSource("tak-shapes", { type: "geojson", data: empty });
  map.addSource("tak-points", { type: "geojson", data: empty });
  const faded: ExpressionSpecification = ["case", ["get", "faded"], 0.45, 1];
  map.addLayer({
    id: "tak-shape-fills",
    type: "fill",
    source: "tak-shapes",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": ["get", "fill"], "fill-opacity": ["*", ["get", "fillOpacity"], faded] },
  });
  map.addLayer({
    id: "tak-shape-lines",
    type: "line",
    source: "tak-shapes",
    paint: {
      "line-color": ["get", "stroke"],
      "line-width": ["get", "strokeWidth"],
      "line-opacity": ["*", ["get", "strokeOpacity"], faded],
      "line-dasharray": ["case", ["get", "faded"], ["literal", [2, 2]], ["literal", [1, 0]]],
    },
  });
  map.addLayer({
    id: "tak-selected-shape",
    type: "line",
    source: "tak-shapes",
    filter: ["==", ["get", "uid"], ""],
    paint: { "line-color": ACCENT, "line-width": 6, "line-opacity": 0.6 },
  });
  addTacticalLayers(map);
  map.addLayer({
    id: "tak-selected-tactical",
    type: "line",
    source: "tak-tactical",
    filter: ["==", ["get", "uid"], ""],
    paint: { "line-color": ACCENT, "line-width": 6, "line-opacity": 0.6 },
  });
  map.addLayer({
    id: "tak-selected-point",
    type: "circle",
    source: "tak-points",
    filter: ["==", ["get", "uid"], ""],
    paint: {
      "circle-radius": 18,
      "circle-color": "transparent",
      "circle-stroke-color": ACCENT,
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "tak-points",
    type: "symbol",
    source: "tak-points",
    layout: {
      "icon-image": ["step", ["zoom"], ["get", "bareIcon"], LABEL_MIN_ZOOM, ["get", "icon"]],
      "icon-offset": ["step", ["zoom"], ["get", "bareOffset"], LABEL_MIN_ZOOM, ["get", "offset"]],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["get", "order"],
    },
    paint: { "icon-opacity": faded },
  });
};

/** The MapLibre map: basemap, TAK items, selection, hover names and the cursor position. */
export const MapCanvas = ({
  items,
  hidden,
  basemap,
  dim,
  selectedUid,
  onSelect,
  onCursor,
  onReady,
}: Props) => {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap>();
  const now = useNow(FADE_CHECK_MS);
  const itemsByUid = useRef(new Map<string, TakItem>());
  itemsByUid.current = new Map(items.map((i) => [i.uid, i]));
  const callbacks = useRef({ onSelect, onCursor, onReady });
  callbacks.current = { onSelect, onCursor, onReady };

  useEffect(() => {
    const m = new MapLibreMap({
      container: container.current as HTMLDivElement,
      style: { version: 8, sources: {}, layers: [] },
      ...savedView(),
      attributionControl: { compact: true },
    });
    m.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    m.keyboard.enable();

    const hover = new Popup({ closeButton: false, closeOnClick: false, offset: 14 });
    const uidAt = (e: MapMouseEvent) =>
      m.queryRenderedFeatures(e.point, { layers: INTERACTIVE_LAYERS })[0]?.properties?.uid as
        | string
        | undefined;

    m.on("load", () => {
      addItemLayers(m);
      setMap(m);
      callbacks.current.onReady(m);
    });
    m.on("moveend", () => saveView(m));
    m.on("click", (e) => callbacks.current.onSelect(uidAt(e)));
    m.on("mousemove", (e) => {
      callbacks.current.onCursor([e.lngLat.lng, e.lngLat.lat]);
      const uid = uidAt(e);
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
      callbacks.current.onCursor(undefined);
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

  useEffect(() => {
    if (!map) return;
    // ponytail: full setData per notify (≤4/s); switch to updateData diffs if large pictures stutter.
    const draw = () => {
      const { points, shapes, tactical } = toSources(map, items, hidden, now);
      (map.getSource("tak-points") as GeoJSONSource).setData(points);
      (map.getSource("tak-shapes") as GeoJSONSource).setData(shapes);
      (map.getSource("tak-tactical") as GeoJSONSource).setData(tactical);
    };
    draw();
    return onTacticalRendered(draw);
  }, [map, items, hidden, now]);

  useEffect(() => {
    if (!map) return;
    const filter = ["==", ["get", "uid"], selectedUid ?? ""] as FilterSpecification;
    map.setFilter("tak-selected-point", filter);
    map.setFilter("tak-selected-shape", filter);
    map.setFilter("tak-selected-tactical", filter);
  }, [map, selectedUid]);

  return <div ref={container} className="tak-map" aria-label="TAK map" role="application" />;
};
