import type { FeatureCollection, Point } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { ACCENT } from "../../theme.ts";
import type { EventFeature } from "../event-layers/layers.ts";
import { slackBox } from "./selection.ts";
import { EMPTY_COLLECTION, geoJsonSource } from "./sources.ts";
import { labelImage } from "./symbols.ts";

export const eventsAt = (map: MapLibreMap, point: { x: number; y: number }) =>
  map
    .queryRenderedFeatures(slackBox(point), { layers: ["bl-event-points"] })
    .map((f) => f.properties as EventFeature["properties"]);

const EVENT_LABEL_MIN_ZOOM = 10;

/** BattleLog events: coloured dots with a white ring, so they never pass for TAK symbols. */
export const addEventLayers = (map: MapLibreMap) => {
  map.addSource("bl-events", { type: "geojson", data: EMPTY_COLLECTION });
  map.addLayer({
    id: "bl-selected-event",
    type: "circle",
    source: "bl-events",
    filter: ["==", ["get", "eventId"], ""],
    paint: {
      "circle-radius": 13,
      "circle-color": "transparent",
      "circle-stroke-color": ACCENT,
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "bl-event-points",
    type: "circle",
    source: "bl-events",
    paint: {
      "circle-radius": 7,
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "bl-event-labels",
    type: "symbol",
    source: "bl-events",
    minzoom: EVENT_LABEL_MIN_ZOOM,
    layout: {
      "icon-image": ["get", "icon"],
      "icon-anchor": "left",
      "icon-offset": [12, 0],
    },
  });
};

/** Keeps `events` drawn, uploading only when they changed, with `selectedEventId` ringed. */
export const useEventFeatures = (
  map: MapLibreMap | undefined,
  events: FeatureCollection<Point, EventFeature["properties"]> | undefined,
  selectedEventId: string | undefined,
) => {
  const drawnEvents = useRef("");
  useEffect(() => {
    const json = JSON.stringify(events ?? EMPTY_COLLECTION);
    if (!map || json === drawnEvents.current) return;
    drawnEvents.current = json;
    const withIcons = {
      ...(events ?? EMPTY_COLLECTION),
      features: (events?.features ?? []).map((f) => ({
        ...f,
        properties: { ...f.properties, icon: labelImage(f.properties.label).id },
      })),
    };
    geoJsonSource(map, "bl-events").setData(withIcons);
  }, [map, events]);

  useEffect(() => {
    map?.setFilter("bl-selected-event", ["==", ["get", "eventId"], selectedEventId ?? ""]);
  }, [map, selectedEventId]);
};
