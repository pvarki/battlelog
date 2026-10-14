import { api } from "../../api.ts";
import { useLiveEvents } from "../../events/live-events.ts";
import {
  type EventLayer,
  LAYER_EVENT_TYPE,
  type LayerDefinition,
  layersOf,
  MAX_LAYER_EVENTS,
} from "./layers.ts";

const LAYER_QUERY = { types: LAYER_EVENT_TYPE };
const isLayerRow = (row: { type: string | null }) => row.type === LAYER_EVENT_TYPE;

/** Every shared BattleLog layer, kept live. `null` until loaded. */
export const useEventLayers = (): EventLayer[] | null => {
  const { events } = useLiveEvents({
    limit: MAX_LAYER_EVENTS,
    query: LAYER_QUERY,
    match: isLayerRow,
  });
  return events && layersOf(events);
};

const failure = (res: { status: number }) => {
  if (res.status === 409)
    return "Someone else changed this layer meanwhile: reopen it and try again";
  return `Saving failed (${res.status})`;
};

/** Saves a new layer, or a new version of `existing`. */
export const saveLayer = async (
  definition: LayerDefinition,
  existing?: EventLayer,
): Promise<{ error?: string; eventId?: string }> => {
  const header = `Map layer: ${definition.name || "(unnamed)"}`;
  try {
    const res = existing
      ? await api.events[":eventId"].$patch({
          param: { eventId: existing.eventId },
          json: { header, data: definition, baseId: existing.rowId },
        })
      : await api.events.$post({ json: { header, type: LAYER_EVENT_TYPE, data: definition } });
    if (!res.ok) return { error: failure(res) };
    return { eventId: (await res.json()).eventId };
  } catch {
    return { error: "Saving failed: no connection" };
  }
};

/** Events can't be deleted: a layer's last version marks it so, and its history stays. */
export const deleteLayer = (layer: EventLayer) =>
  saveLayer({ ...layer.definition, deleted: true }, layer);
