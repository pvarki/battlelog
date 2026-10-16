import "maplibre-gl/dist/maplibre-gl.css";
import type { FeatureCollection, Point } from "geojson";
import {
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";
import { useNow } from "../../use-now.ts";
import type { Position, TakItem } from "../cot.ts";
import type { EventFeature } from "../event-layers/layers.ts";
import { labelOf } from "../items.ts";
import type { MapView } from "../tools.ts";
import type { MapSource } from "./basemaps.ts";
import type { Cursor } from "./cursor.ts";
import { addEventLayers, eventsAt, useEventFeatures } from "./event-layers.ts";
import { addItemLayers } from "./item-layers.ts";
import { followLaser } from "./laser.ts";
import { addMgrsGridLayers, useMgrsGrid } from "./mgrs-grid-layer.ts";
import { type Preview, PreviewLayer } from "./PreviewLayer.tsx";
import { usePictureLayer } from "./picture-layer.ts";
import { showRasters } from "./rasters.ts";
import { dragSelectBox, followLasso, uidsAt, useItemSelection } from "./selection.ts";
import { serveMapImages } from "./symbols.ts";

// MapLibre looks for its worker beside its own module, which a bundle doesn't ship:
// without it no GeoJSON source loads in a production build.
setWorkerUrl(workerUrl);

import { useTracks } from "./tracks.ts";

type Props = {
  items: TakItem[];
  /** Where the pointer is on this map. */
  cursor: Cursor;
  /** What's being drawn, in its final look, on its own layers: the pointer moving it redraws only that. */
  preview?: Preview;
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
  /** While on, the pointer is a laser for briefings and dragging draws fading strokes instead of panning. */
  laser?: boolean;
  onReady: (map: MapLibreMap | undefined) => void;
  /** Where the map opens; absent = where this browser last left a map. */
  view?: MapView;
  /** Whether moving the map is remembered for the next map opened without a view; default: only without one. */
  rememberView?: boolean;
  /** The zoom and compass buttons; default shown. Read once: change it by remounting. */
  zoomButtons?: boolean;
  /** Dragging, scrolling and pinching move the map; default on. Off, the view only changes from code. */
  panZoom?: boolean;
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
  laser = false,
  onReady,
  view,
  rememberView,
  zoomButtons = true,
  panZoom = true,
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
  const remember = useRef(rememberView ?? !view);
  const showZoomButtons = useRef(zoomButtons);

  useEffect(() => {
    const m = new MapLibreMap({
      // Labels and symbols appear at once, like tiles (raster-fade-duration in rasters.ts).
      fadeDuration: 0,
      container: container.current as HTMLDivElement,
      style: { version: 8, sources: {}, layers: [] },
      ...(startView.current ?? savedView()),
      attributionControl: { compact: true },
    });
    serveMapImages(m);
    if (showZoomButtons.current)
      m.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");
    m.keyboard.enable();
    // Compact attribution opens expanded until the first drag; on a small widget it hides the map.
    m.once("idle", () =>
      m
        .getContainer()
        .querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show"),
    );

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
    if (remember.current) m.on("moveend", () => saveView(m));
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

  useEffect(() => {
    if (!map) return;
    const {
      dragPan,
      scrollZoom,
      boxZoom,
      dragRotate,
      keyboard,
      doubleClickZoom,
      touchPitch,
      touchZoomRotate,
    } = map;
    for (const handler of [
      dragPan,
      scrollZoom,
      boxZoom,
      dragRotate,
      keyboard,
      doubleClickZoom,
      touchPitch,
    ])
      panZoom ? handler.enable() : handler.disable();
    panZoom ? touchZoomRotate.enable() : touchZoomRotate.disable();
  }, [map, panZoom]);

  const lassoing = !!onLasso;
  const lassoCallback = useRef(onLasso);
  lassoCallback.current = onLasso;
  useEffect(() => {
    if (!map || !lassoing) return;
    return followLasso(map, (uids) => lassoCallback.current?.(uids));
  }, [map, lassoing]);

  useEffect(() => {
    if (map && laser) return followLaser(map);
  }, [map, laser]);

  useMgrsGrid(map, showMgrsGrid);
  usePictureLayer(map, items, hidden, now, bearing);

  useEffect(() => {
    if (!map) return;
    for (const layer of map.getStyle().layers) {
      if (layer.type === "symbol" && layer.id.startsWith("tak-"))
        map.setLayoutProperty(layer.id, "icon-size", symbolScale);
    }
  }, [map, symbolScale]);

  useTracks(map, tracks);
  useEventFeatures(map, events, selectedEventId);
  useItemSelection(map, selectedUids);

  return (
    <>
      <div ref={container} className="tak-map" aria-label="TAK map" role="application" />
      {map && preview && <PreviewLayer map={map} bearing={bearing} cursor={cursor} {...preview} />}
    </>
  );
};
