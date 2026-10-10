import "leaflet/dist/leaflet.css";
import "./tak-map.css";
import { ActionIcon, Badge, Box } from "@mantine/core";
import { IconLayoutSidebarRight } from "@tabler/icons-react";
import L from "leaflet";
import ms from "milsymbol";
import { useEffect, useRef, useState } from "react";
import type { TakFeature } from "../../api.ts";
import { useIsMobile } from "../../dashboard/mobile.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { CONNECTION_LABEL } from "../../live-events.ts";
import { Placeholder } from "../../Placeholder.tsx";
import { useTakState } from "../../tak-state.ts";
import { Panel } from "./Panel.tsx";
import { anchorOf, hasPosition, isFaded, layerOf, sidcFor, teamColor } from "./symbols.ts";
import { BASEMAPS, LAYERS, type Layer, type TakMapConfig } from "./widget.ts";

const FINLAND: L.LatLngTuple = [64.5, 26];
const FADE_CHECK_MS = 30_000;
const DEFAULT_MARKER_COLOR = "#ffd43b";

const latLng = ([lon, lat]: [number, number]): L.LatLngTuple => [lat, lon];

const label = (layer: L.Layer, text: string | undefined, permanent: boolean) => {
  if (text) layer.bindTooltip(text, { permanent, direction: "right", className: "tak-label" });
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

const TakMapView = ({ config }: WidgetViewProps<TakMapConfig>) => {
  const { enabled, items, connection } = useTakState();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map>(null);
  const layersRef = useRef<Record<Layer, L.LayerGroup>>(null);
  const fittedRef = useRef(false);
  const [now, setNow] = useState(Date.now);
  const isMobile = useIsMobile();
  const [panelOpen, setPanelOpen] = useState(!isMobile);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((f) => f.id === selectedId);

  const select = (id: string | null) => {
    setSelectedId(id);
    const f = items.find((i) => i.id === id);
    if (f && hasPosition(f)) mapRef.current?.panTo(latLng(anchorOf(f)));
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), FADE_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, { center: FINLAND, zoom: 5, worldCopyJump: true });
    mapRef.current = map;
    layersRef.current = Object.fromEntries(
      LAYERS.map((layer) => [layer, L.layerGroup().addTo(map)]),
    ) as Record<Layer, L.LayerGroup>;
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
    const tiles = L.tileLayer(url, { attribution, maxZoom: 19 }).addTo(map);
    tiles.bringToBack();
    return () => {
      tiles.remove();
    };
  }, [config.basemap]);

  // ponytail: full redraw per update batch (≤4/s); diff by id if item counts reach thousands.
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    for (const group of Object.values(layers)) group.clearLayers();
    const drawn: L.Layer[] = [];
    for (const f of items) {
      const layer = layerOf(f);
      if (config.hiddenLayers.includes(layer) || !hasPosition(f)) continue;
      const shape = shapeOf(f, isFaded(f, now)).on("click", () => {
        setSelectedId(f.id);
        setPanelOpen(true);
      });
      layers[layer].addLayer(shape);
      drawn.push(shape);
    }
    if (!fittedRef.current && drawn.length > 0) {
      fittedRef.current = true;
      const bounds = L.featureGroup(drawn).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
    }
  }, [items, config.hiddenLayers, now]);

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
        <Box pos="absolute" top={8} right={8} style={{ zIndex: 1002, display: "flex", gap: 8 }}>
          {connection !== "live" && (
            <Badge color="warning" variant="filled">
              {CONNECTION_LABEL[connection]}
            </Badge>
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
          <Panel items={items} selected={selected} now={now} onSelect={select} />
        </Box>
      )}
    </Box>
  );
};

export default TakMapView;
