import { useEffect, useRef, useState } from "react";

/** One TAK item or one BattleLog event, never both: the event wins when a URL carries both. */
export type Selection = { tak?: string; event?: string };

const selectionKey = (s: Selection) => `${s.tak ?? ""}|${s.event ?? ""}`;

/**
 * What a map has selected, two-way with `selection` held outside (a dashboard
 * keeps it in the URL so other widgets follow): a change from outside selects
 * it here, a pick here goes out through `onSelect`.
 */
export const useSelection = ({
  selection,
  onSelect,
  centreOnSelection = true,
}: {
  selection?: Selection;
  onSelect?: (selection: Selection) => void;
  centreOnSelection?: boolean;
}) => {
  const [selectedUid, setSelectedUidState] = useState<string>();
  const [selectedEventId, setSelectedEventId] = useState<string>();
  // A selection made in another widget is highlighted, not opened: details would hide the map it's shown on.
  const [selectedOutside, setSelectedOutside] = useState(false);
  /** An outside selection still to bring into view once the map and its data have it. */
  const pendingCentre = useRef<Selection>(undefined);

  /** Selecting a TAK item lets go of any selected event, and back. */
  const selectUid = (uid: string | undefined) => {
    setSelectedUidState(uid);
    setSelectedOutside(false);
    pendingCentre.current = undefined;
    if (uid) setSelectedEventId(undefined);
  };
  const selectEvent = (eventId: string | undefined) => {
    setSelectedEventId(eventId);
    setSelectedOutside(false);
    pendingCentre.current = undefined;
    if (eventId) setSelectedUidState(undefined);
  };

  const outside = selection && {
    tak: selection.event ? undefined : selection.tak,
    event: selection.event,
  };
  const outsideKey = outside && selectionKey(outside);
  const insideKey = selectionKey({ tak: selectedUid, event: selectedEventId });
  const lastOutside = useRef<string>(undefined);
  const lastInside = useRef(insideKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new outside selection moves the map
  useEffect(() => {
    if (!outside || outsideKey === lastOutside.current) return;
    lastOutside.current = outsideKey;
    // Our own pick coming back through the URL.
    if (outsideKey === insideKey) return;
    setSelectedUidState(outside.tak);
    setSelectedEventId(outside.event);
    setSelectedOutside(true);
    pendingCentre.current = centreOnSelection ? outside : undefined;
  }, [outsideKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reports picks made here, nothing else
  useEffect(() => {
    if (insideKey === lastInside.current) return;
    lastInside.current = insideKey;
    if (insideKey !== outsideKey) onSelect?.({ tak: selectedUid, event: selectedEventId });
  }, [insideKey]);

  return {
    selectedUid,
    selectedEventId,
    selectedOutside,
    selectUid,
    selectEvent,
    pendingCentre,
  };
};

/**
 * Brings a pending outside selection into view once `centre` can: it returns
 * false while the map or the selected thing's data isn't there yet, and is
 * tried again after every render until it succeeds.
 */
export const useCentreWhenReady = (
  pending: { current: Selection | undefined },
  centre: (target: Selection) => boolean,
) => {
  useEffect(() => {
    const target = pending.current;
    if (target && centre(target)) pending.current = undefined;
  });
};
