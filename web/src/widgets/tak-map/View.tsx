import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "./tak-map.css";
import { ActionIcon, Badge, Box } from "@mantine/core";
import { IconLayoutSidebarRight, IconPin, IconPinFilled } from "@tabler/icons-react";
import ms from "milsymbol";
import L from "./leaflet-global.ts";
import "leaflet.markercluster";
import { useEffect, useRef, useState } from "react";
import type { TakFeature } from "../../api.ts";
import { useIsMobile } from "../../dashboard/mobile.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { CONNECTION_LABEL } from "../../live-events.ts";
import { Placeholder } from "../../Placeholder.tsx";
import { useTakState } from "../../tak-state.ts";
import { Panel, type PanelTab } from "./Panel.tsx";
import {
  anchorOf,
  CLUSTER_KINDS,
  type ClusterKind,
  clusterKindOf,
  formatMgrs,
  hasPosition,
  isFaded,
  layerOf,
  liveItems,
  MISSION_PROBLEM_TEXT,
  missionItems,
  missionProblems,
  sidcFor,
  teamColor,
  withAutoTitle,
} from "./symbols.ts";
import { BASEMAPS, type TakMapConfig } from "./widget.ts";

const FINLAND: L.LatLngTuple = [64.5, 26];
const FADE_CHECK_MS = 30_000;
const DEFAULT_MARKER_COLOR = "#ffd43b";
// Below this zoom, permanent labels pile into an unreadable smear (ATAK hides them too).
const LABEL_MIN_ZOOM = 9;
const SELECT_MIN_ZOOM = 12;
const MAX_ZOOM = 19;
const CLUSTER_RADIUS_PX = 40;
// TAK markers sit metres apart (a checkpoint and its laavu), so keep grouping past street level.
const UNCLUSTER_ZOOM = 16;

type MapLayers = {
  /** Point items, grouped per kind into count bubbles when they would overlap. */
  points: Record<ClusterKind, L.MarkerClusterGroup>;
  shapes: L.LayerGroup;
  selection: L.LayerGroup;
};

const clusterIcon = (kind: ClusterKind) => (cluster: L.MarkerCluster) =>
  L.divIcon({
    html: `<span class="tak-cluster-badge tak-cluster-${kind}"><b>${cluster.getChildCount()}</b></span>`,
    className: "tak-cluster",
    iconSize: [32, 32],
  });

/** Where the pointer is, in MGRS, or the map centre when it isn't over the map. */
const coordinatesControl = (map: L.Map) => {
  const el = L.DomUtil.create("div", "tak-coords");
  const show = (at: L.LatLng) => {
    el.textContent = formatMgrs([at.lng, at.lat]) ?? `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}`;
  };
  const showCentre = () => show(map.getCenter());
  map.on("mousemove", (e) => show(e.latlng));
  map.on("mouseout moveend", showCentre);
  showCentre();
  return new (L.Control.extend({ onAdd: () => el }))({ position: "bottomleft" });
};

const highlightOf = (f: TakFeature): L.Layer => {
  const g = f.geometry;
  if (g.type === "Point" && !f.properties.radius) {
    // Black under white reads on both light and dark basemaps.
    const ring = (color: string, weight: number) =>
      L.circleMarker(latLng(g.coordinates), {
        pane: "takSelectedPoint",
        radius: 18,
        color,
        weight,
        fill: false,
        interactive: false,
        className: "tak-selected",
      });
    return L.layerGroup([ring("#000", 7), ring("#fff", 3)]);
  }
  const halo: L.PathOptions = {
    pane: "takSelectedShape",
    color: "#fff",
    opacity: 0.8,
    weight: (f.properties.strokeWidth ?? 3) + 8,
    fill: false,
    interactive: false,
  };
  if (g.type === "Point")
    return L.circle(latLng(g.coordinates), { ...halo, radius: f.properties.radius });
  if (g.type === "Polygon")
    return L.polygon(
      g.coordinates.map((ring) => ring.map(latLng)),
      halo,
    );
  return L.polyline(g.coordinates.map(latLng), halo);
};

const latLng = ([lon, lat]: [number, number]): L.LatLngTuple => [lat, lon];

// Callsigns and names come from any TAK user: render them as text, never HTML.
const label = (layer: L.Layer, text: string | undefined, permanent: boolean) => {
  if (text) {
    const content = document.createElement("span");
    content.textContent = text;
    const className = permanent ? "tak-label tak-label-permanent" : "tak-label";
    layer.bindTooltip(content, { permanent, direction: "right", className });
  }
  return layer;
};

const unitIcon = (cotType: string) => {
  const symbol = new ms.Symbol(sidcFor(cotType), { size: 22 });
  const { x, y } = symbol.getAnchor();
  const { width, height } = symbol.getSize();
  return L.divIcon({
    html: symbol.asSVG(),
    className: "tak-unit",
    iconSize: [width, height],
    iconAnchor: [x, y],
  });
};

const shapeOf = (f: TakFeature, faded: boolean): L.Layer => {
  const p = f.properties;
  const g = f.geometry;
  const fadedClass = faded ? "tak-faded" : "";

  if (g.type === "Point") {
    const at = latLng(g.coordinates);
    if (p.radius) {
      return label(
        L.circle(at, {
          radius: p.radius,
          color: p.stroke?.color ?? DEFAULT_MARKER_COLOR,
          opacity: p.stroke?.opacity ?? 1,
          weight: p.strokeWidth ?? 3,
          fillColor: p.fill?.color,
          fillOpacity: p.fill?.opacity ?? 0,
          className: fadedClass,
        }),
        p.callsign,
        false,
      );
    }
    switch (layerOf(f)) {
      case "contacts":
        return label(
          L.circleMarker(at, {
            radius: 7,
            color: "#000",
            weight: 1.5,
            fillColor: teamColor(p.team),
            fillOpacity: 1,
            className: fadedClass,
          }),
          p.callsign,
          true,
        );
      case "units":
        return label(
          L.marker(at, { icon: unitIcon(p.cotType), opacity: faded ? 0.45 : 1 }),
          p.callsign,
          true,
        );
      default:
        return label(
          L.circleMarker(at, {
            radius: 6,
            color: "#000",
            weight: 1,
            fillColor: p.stroke?.color ?? DEFAULT_MARKER_COLOR,
            fillOpacity: 1,
            className: fadedClass,
          }),
          p.callsign,
          true,
        );
    }
  }

  const style: L.PathOptions = {
    color: p.stroke?.color ?? DEFAULT_MARKER_COLOR,
    opacity: p.stroke?.opacity ?? 1,
    weight: p.strokeWidth ?? 3,
    fillColor: p.fill?.color,
    fillOpacity: p.fill?.opacity ?? 0,
    className: fadedClass,
  };
  if (g.type === "Polygon") {
    return label(
      L.polygon(
        g.coordinates.map((ring) => ring.map(latLng)),
        style,
      ),
      p.callsign,
      false,
    );
  }
  const line = label(L.polyline(g.coordinates.map(latLng), style), p.callsign, false);
  if (!p.checkpoints?.length) return line;
  return L.featureGroup([
    line,
    ...p.checkpoints.map((c) =>
      label(
        L.circleMarker(latLng(c.coordinates), {
          radius: 4,
          color: style.color,
          fillColor: "#fff",
          fillOpacity: 1,
          weight: 2,
          className: fadedClass,
        }),
        c.name,
        true,
      ),
    ),
  ]);
};

const TakMapView = ({
  config,
  editMode,
  updateConfig,
  onConfigure,
}: WidgetViewProps<TakMapConfig>) => {
  const tak = useTakState();
  const { enabled, missions, connection } = tak;
  const problems = tak.missionsLoaded ? missionProblems(config, missions) : [];
  const [now, setNow] = useState(Date.now);
  const items = liveItems(tak.items, config, now);
  const everything = [...items, ...missionItems(missions, config, items)];
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map>(null);
  const layersRef = useRef<MapLayers>(null);
  const pointsByIdRef = useRef(new Map<string, { marker: L.Layer; kind: ClusterKind }>());
  const fittedRef = useRef(false);
  const followingRef = useRef(false);
  const savedView = config.view === "saved" ? config.savedView : null;
  const { lat: savedLat, lon: savedLon, zoom: savedZoom } = savedView ?? {};
  const isMobile = useIsMobile();
  const [panelOpen, setPanelOpen] = useState(!isMobile && config.panelOpen);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<PanelTab>(config.showLive ? "users" : "missions");
  const selected = everything.find((f) => f.id === selectedId);

  const select = (id: string | null) => {
    setSelectedId(id);
    const f = everything.find((i) => i.id === id);
    const map = mapRef.current;
    if (!f || !map || !hasPosition(f)) return;
    const zoom = Math.max(map.getZoom(), SELECT_MIN_ZOOM);
    const point = pointsByIdRef.current.get(f.id);
    if (!point || !layersRef.current) return map.setView(latLng(anchorOf(f)), zoom);
    map.setView(latLng(anchorOf(f)), zoom, { animate: false });
    // Still grouped at this zoom: zoom further or spread the group until the item shows.
    layersRef.current.points[point.kind].zoomToShowLayer(point.marker);
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), FADE_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, { center: FINLAND, zoom: 5, maxZoom: MAX_ZOOM, worldCopyJump: true });
    mapRef.current = map;
    // Halo under the shapes it outlines; ring over the markers it circles.
    map.createPane("takSelectedShape").style.zIndex = "390";
    map.createPane("takSelectedPoint").style.zIndex = "650";
    layersRef.current = {
      shapes: L.layerGroup().addTo(map),
      points: Object.fromEntries(
        CLUSTER_KINDS.map((kind) => [
          kind,
          L.markerClusterGroup({
            maxClusterRadius: CLUSTER_RADIUS_PX,
            disableClusteringAtZoom: UNCLUSTER_ZOOM,
            showCoverageOnHover: false,
            iconCreateFunction: clusterIcon(kind),
          }).addTo(map),
        ]),
      ) as Record<ClusterKind, L.MarkerClusterGroup>,
      selection: L.layerGroup().addTo(map),
    };
    L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);
    coordinatesControl(map).addTo(map);
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(el);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { url, attribution } = BASEMAPS[config.basemap];
    const tiles = L.tileLayer(url, { attribution, maxZoom: MAX_ZOOM }).addTo(map);
    tiles.bringToBack();
    return () => {
      tiles.remove();
    };
  }, [config.basemap]);

  useEffect(() => {
    const map = mapRef.current;
    const el = containerRef.current;
    if (!map || !el) return;
    const toggleLabels = () =>
      el.classList.toggle(
        "tak-labels-hidden",
        config.labels === "never" || (config.labels === "auto" && map.getZoom() < LABEL_MIN_ZOOM),
      );
    map.on("zoomend", toggleLabels);
    toggleLabels();
    return () => {
      map.off("zoomend", toggleLabels);
    };
  }, [config.labels]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (savedLat !== undefined && savedLon !== undefined && savedZoom !== undefined) {
      map.setView([savedLat, savedLon], savedZoom);
    } else {
      fittedRef.current = false;
    }
    // The saved view's fields, not its identity: every config save rebuilds the object.
  }, [savedLat, savedLon, savedZoom]);

  // ponytail: full redraw per update batch (≤4/s); diff by id if item counts reach thousands.
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    for (const group of Object.values(layers.points)) group.clearLayers();
    layers.shapes.clearLayers();
    pointsByIdRef.current.clear();
    const drawn: L.Layer[] = [];
    const points = Object.fromEntries(CLUSTER_KINDS.map((k) => [k, [] as L.Layer[]]));
    const live = liveItems(tak.items, config, now);
    const fromMissions = missionItems(missions, config, live);
    for (const f of [...live, ...fromMissions]) {
      const layer = layerOf(f);
      if (config.hiddenLayers.includes(layer) || !hasPosition(f)) continue;
      // Mission contents persist past their stale time, so they are never greyed.
      const faded = !fromMissions.includes(f) && isFaded(f, now);
      const shape = shapeOf(f, faded).on("click", () => {
        setSelectedId(f.id);
        setPanelOpen(true);
      });
      const isPoint = f.geometry.type === "Point" && !f.properties.radius;
      if (isPoint) {
        const kind = clusterKindOf(f);
        points[kind]?.push(shape);
        pointsByIdRef.current.set(f.id, { marker: shape, kind });
      } else layers.shapes.addLayer(shape);
      drawn.push(shape);
    }
    for (const kind of CLUSTER_KINDS) layers.points[kind].addLayers(points[kind] ?? []);
    const followed = live.find(
      (f) =>
        f.id === config.followId && !config.hiddenLayers.includes(layerOf(f)) && hasPosition(f),
    );
    if (followed) {
      followingRef.current = true;
      map.panTo(latLng(anchorOf(followed)));
      return;
    }
    if (followingRef.current) {
      followingRef.current = false;
      if (savedView) map.setView([savedView.lat, savedView.lon], savedView.zoom);
      else fittedRef.current = false;
    }
    const fit = config.view === "fit-always" || (!fittedRef.current && !savedView);
    if (fit && drawn.length > 0) {
      fittedRef.current = true;
      const bounds = L.featureGroup(drawn).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    }
  }, [tak.items, missions, config, savedView, now]);

  useEffect(() => {
    const selection = layersRef.current?.selection;
    if (!selection || !selected || !hasPosition(selected)) return;
    const highlight = highlightOf(selected).addTo(selection);
    return () => {
      highlight.remove();
    };
  }, [selected]);

  const toggleMission = (name: string) =>
    updateConfig(
      withAutoTitle(config, {
        ...config,
        missionNames: config.missionNames.includes(name)
          ? config.missionNames.filter((m) => m !== name)
          : [...config.missionNames, name],
      }),
    );

  const toggleFollow = (id: string) =>
    updateConfig({ ...config, followId: config.followId === id ? null : id });

  const showMissionProblems = () => {
    setSelectedId(null);
    setPanelTab("missions");
    setPanelOpen(true);
  };
  const [firstProblem] = problems;
  // A missions-only widget with nothing it may show: say why instead of an empty map.
  const blocked = !config.showLive && firstProblem && everything.length === 0;

  const pinned = config.view === "saved" && config.savedView !== null;
  const togglePin = () => {
    const map = mapRef.current;
    if (!map) return;
    if (pinned) return updateConfig({ ...config, view: "fit-once" });
    const { lat, lng } = map.getCenter();
    updateConfig({ ...config, view: "saved", savedView: { lat, lon: lng, zoom: map.getZoom() } });
  };

  return (
    <Box pos="relative" h="100%" style={{ display: "flex" }}>
      <Box pos="relative" h="100%" style={{ flex: 1, minWidth: 0 }}>
        <Box ref={containerRef} h="100%" className="tak-map" />
        {enabled === false && (
          <Box pos="absolute" inset={0} bg="dark.8" style={{ zIndex: 1000 }}>
            <Placeholder
              title="TAK not connected"
              detail="This BattleLog server has no TAK Server configured (TAK_ENABLED)."
            />
          </Box>
        )}
        {enabled !== false && blocked && (
          <Box pos="absolute" inset={0} bg="dark.8" style={{ zIndex: 1000 }}>
            <Placeholder
              title={
                problems.length === 1
                  ? `${firstProblem.name} is not available`
                  : `${problems.length} missions are not available`
              }
              detail={
                problems.length === 1
                  ? MISSION_PROBLEM_TEXT[firstProblem.reason].detail
                  : problems
                      .map((p) => `${p.name}: ${MISSION_PROBLEM_TEXT[p.reason].label}`)
                      .join(" · ")
              }
              action={{ label: "Choose missions", onClick: onConfigure }}
            />
          </Box>
        )}
        <Box pos="absolute" top={8} right={8} style={{ zIndex: 1002, display: "flex", gap: 8 }}>
          {firstProblem && !blocked && (
            <Badge
              component="button"
              color="warning"
              variant="filled"
              style={{ cursor: "pointer" }}
              onClick={showMissionProblems}
              title="Show which missions and why"
            >
              {problems.length === 1
                ? `${firstProblem.name} not available`
                : `${problems.length} missions not available`}
            </Badge>
          )}
          {connection !== "live" && (
            <Badge color="warning" variant="filled">
              {CONNECTION_LABEL[connection]}
            </Badge>
          )}
          {/* The saved view is shared by everyone using the dashboard: an editing action. */}
          {editMode && (
            <ActionIcon
              variant="filled"
              color={pinned ? "accent" : "dark"}
              onClick={togglePin}
              aria-pressed={pinned}
              aria-label={
                pinned ? "Saved view in use: click to fit to items instead" : "Save this view"
              }
              title={pinned ? "Saved view in use: click to fit to items instead" : "Save this view"}
            >
              {pinned ? <IconPinFilled size={16} /> : <IconPin size={16} />}
            </ActionIcon>
          )}
          <ActionIcon
            variant="filled"
            color="dark"
            onClick={() => setPanelOpen((open) => !open)}
            aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
          >
            <IconLayoutSidebarRight size={16} />
          </ActionIcon>
        </Box>
      </Box>
      {panelOpen && (
        // On a phone the panel overlays the map instead of squeezing it.
        <Box
          w={isMobile ? "80%" : 240}
          h="100%"
          bg="dark.7"
          pos={isMobile ? "absolute" : "relative"}
          right={0}
          style={{
            flexShrink: 0,
            zIndex: 1001,
            borderLeft: "1px solid var(--mantine-color-dark-4)",
          }}
        >
          <Panel
            items={items}
            missions={missions}
            config={config}
            problems={problems}
            tab={panelTab}
            onTabChange={setPanelTab}
            onToggleMission={toggleMission}
            onToggleFollow={toggleFollow}
            selected={selected}
            now={now}
            onSelect={select}
          />
        </Box>
      )}
    </Box>
  );
};

export default TakMapView;
