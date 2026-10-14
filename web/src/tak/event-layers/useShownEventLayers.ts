import { useEffect, useState } from "react";
import { api, type EventResponse } from "../../api.ts";
import { useNow } from "../use-now.ts";
import type { LayerEvents } from "./EventLayerFeeds.tsx";
import { featureCollection, layerFeatures } from "./layers.ts";
import { useEventLayers } from "./store.ts";

const LAYER_CLOCK_MS = 60_000;

/** The BattleLog layers on the map, their events as features, and the selected event. */
export const useShownEventLayers = ({
  shownLayerIds,
  replayAt,
  selectedEventId,
}: {
  shownLayerIds: ReadonlySet<string>;
  /** The replayed moment, which layers are judged at; undefined when live. */
  replayAt: number | undefined;
  selectedEventId: string | undefined;
}) => {
  const eventLayers = useEventLayers();
  const shownLayers = (eventLayers ?? []).filter((l) => shownLayerIds.has(l.eventId));
  const [layerEvents, setLayerEvents] = useState<ReadonlyMap<string, LayerEvents>>(new Map());
  const onLayerEvents = (layerId: string, events: LayerEvents | undefined) =>
    setLayerEvents((current) => {
      if (current.get(layerId) === events) return current;
      const next = new Map(current);
      if (events) next.set(layerId, events);
      else next.delete(layerId);
      return next;
    });
  const layerClock = useNow(LAYER_CLOCK_MS);
  const eventFeatures = featureCollection(
    shownLayers.flatMap((layer) =>
      layerFeatures(layer, layerEvents.get(layer.eventId)?.events ?? [], replayAt ?? layerClock),
    ),
  );
  const shownEvent = (eventId: string | undefined) => {
    if (!eventId) return undefined;
    const drawn = eventFeatures.features.some((f) => f.properties.eventId === eventId);
    if (!drawn) return undefined;
    for (const layer of shownLayers) {
      const found = layerEvents.get(layer.eventId)?.events.find((e) => e.eventId === eventId);
      if (found) return found;
    }
  };
  const drawnEvent = shownEvent(selectedEventId);
  const drawn = !!drawnEvent;
  // An event opened from elsewhere (an item's log entries) needn't be on a shown layer.
  const [fetchedEvent, setFetchedEvent] = useState<EventResponse>();
  useEffect(() => {
    if (!selectedEventId || drawn) return;
    let alive = true;
    api.events[":eventId"]
      .$get({ param: { eventId: selectedEventId } })
      .then(async (res) => {
        if (res.status === 200 && alive) setFetchedEvent(await res.json());
      })
      .catch((err: unknown) => console.warn("Loading the selected event failed", err));
    return () => {
      alive = false;
    };
  }, [selectedEventId, drawn]);
  const selectedEvent =
    drawnEvent ?? (fetchedEvent?.eventId === selectedEventId ? fetchedEvent : undefined);
  const truncatedLayers = new Set(
    [...layerEvents].flatMap(([id, events]) => (events.truncated ? [id] : [])),
  );
  return {
    eventLayers,
    shownLayers,
    layerEvents,
    onLayerEvents,
    eventFeatures,
    selectedEvent,
    truncatedLayers,
  };
};
