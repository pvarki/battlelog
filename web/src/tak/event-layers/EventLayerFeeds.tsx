import { useEffect } from "react";
import type { EventResponse } from "../../api.ts";
import { queryFilter } from "../../event-binding/query.ts";
import { useLiveEvents } from "../../events/live-events.ts";
import { useNow } from "../../use-now.ts";
import { type EventLayer, layerFetch, MAX_LAYER_EVENTS } from "./layers.ts";

const HOUR_MS = 60 * 60 * 1000;

export type LayerEvents = { events: EventResponse[]; truncated: boolean };

type FeedProps = {
  layer: EventLayer;
  replayWindowMs: number;
  onEvents: (layerId: string, events: LayerEvents | undefined) => void;
};

/** One layer's events, live; renders nothing. A component per layer, as hooks can't loop. */
const LayerFeed = ({ layer, replayWindowMs, onEvents }: FeedProps) => {
  // Hourly is enough: layerFetch rounds to the hour, and the drawn window is cut by the caller.
  const now = useNow(HOUR_MS);
  const { query, windowHours } = layer.definition;
  const fetch = layerFetch(query, windowHours, now, replayWindowMs);
  const { events } = useLiveEvents({ limit: MAX_LAYER_EVENTS, ...fetch });
  const id = layer.eventId;
  useEffect(() => {
    onEvents(id, events ? { events, truncated: events.length >= MAX_LAYER_EVENTS } : undefined);
  }, [id, events, onEvents]);
  useEffect(() => () => onEvents(id, undefined), [id, onEvents]);
  return null;
};

/** Keeps `onEvents` told of every shown layer's events. */
export const EventLayerFeeds = ({
  layers,
  ...rest
}: { layers: EventLayer[] } & Omit<FeedProps, "layer">) =>
  layers
    .filter((layer) => queryFilter(layer.definition.query))
    .map((layer) => <LayerFeed key={layer.rowId} layer={layer} {...rest} />);
