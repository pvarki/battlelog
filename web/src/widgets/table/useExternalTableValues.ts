import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api.ts";
import { subscribeToEvents } from "../../live-events.ts";
import {
  externalSourceIdsForDocument,
  parseTableDocument,
  type ExternalTableSources,
  type TableDoc,
} from "./workbook.ts";

/**
 * Loads source tables as runtime-only hidden sheets. The formulas themselves
 * stay native Univer formulas; this hook merely gives the workbook its source
 * data and follows later event-head updates over SSE.
 */
export const useExternalTableSources = (document: TableDoc): ExternalTableSources => {
  const sourceKey = externalSourceIdsForDocument(document).join(":");
  const sourceIds = useMemo(() => (sourceKey ? sourceKey.split(":") : []), [sourceKey]);
  const cache = useRef(new Map<string, TableDoc | null>());
  const [sources, setSources] = useState<ExternalTableSources>({});

  useEffect(() => {
    let cancelled = false;
    const missing = sourceIds.filter((eventId) => !cache.current.has(eventId));
    const publish = () => {
      if (cancelled) return;
      const next: ExternalTableSources = {};
      for (const eventId of sourceIds) {
        if (cache.current.has(eventId)) next[eventId] = cache.current.get(eventId);
      }
      setSources(next);
    };

    publish();
    if (!missing.length)
      return () => {
        cancelled = true;
      };

    void Promise.all(
      missing.map(async (eventId) => {
        try {
          const response = await api.events[":eventId"].$get({ param: { eventId } });
          if (response.status !== 200) return [eventId, null] as const;
          const event = await response.json();
          return [eventId, parseTableDocument(event.data)] as const;
        } catch {
          return [eventId, null] as const;
        }
      }),
    ).then((loaded) => {
      if (cancelled) return;
      for (const [eventId, table] of loaded) cache.current.set(eventId, table);
      publish();
    });

    return () => {
      cancelled = true;
    };
  }, [sourceIds]);

  useEffect(
    () =>
      subscribeToEvents((event) => {
        const eventId = event.eventId.toLowerCase();
        if (!sourceIds.includes(eventId)) return;
        const table = parseTableDocument(event.data);
        cache.current.set(eventId, table);
        setSources((current) => ({ ...current, [eventId]: table }));
      }),
    [sourceIds],
  );

  return sources;
};
