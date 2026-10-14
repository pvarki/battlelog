import "./tak.css";
import { ActionIcon, Alert, Button, Group, Text } from "@mantine/core";
import {
  IconCrosshair,
  IconCurrentLocation,
  IconExternalLink,
  IconPlayerPlay,
} from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { answerPick, cancelPick, usePickRequest } from "../map-pick.ts";
import { useNow } from "../use-now.ts";
import type { Position, TakItem } from "./cot.ts";
import { EmergencyBanner } from "./emergency/EmergencyBanner.tsx";
import { EventLayerFeeds } from "./event-layers/EventLayerFeeds.tsx";
import { useShownEventLayers } from "./event-layers/useShownEventLayers.ts";
import { takSender, useCallsign } from "./identity.ts";
import { LogItemDialog } from "./items/ItemLog.tsx";
import { hasPosition } from "./items.ts";
import { DEFAULT_BASEMAP, type MapSource, useMapSources } from "./map/basemaps.ts";
import { centreOnItem, flyToPosition } from "./map/camera.ts";
import { createCursor } from "./map/cursor.ts";
import { type Follow, followedItems, positionsOf, useFollow } from "./map/follow.ts";
import { MapCanvas, viewOf } from "./map/MapCanvas.tsx";
import { PickChooser } from "./map/PickChooser.tsx";
import { useMissions, useMissionsSync } from "./missions/store.ts";
import { useMissionSubscriptions } from "./missions/writes.ts";
import { workspacePicture } from "./picture.ts";
import { useOwnPosition } from "./position/useOwnPosition.ts";
import { SearchBox } from "./SearchBox.tsx";
import { CONNECTION_TEXT } from "./StatusBar.tsx";
import {
  setTakPresence,
  useTakItems,
  useTakSession,
  useTakStatus,
  useTakTracks,
} from "./session.ts";
import { useMapSettings } from "./settings.ts";
import { type MapView, viewParam } from "./tools.ts";
import { trackFeatures } from "./tracks.ts";
import { type Selection, useCentreWhenReady, useSelection } from "./use-selection.ts";
import { SelectionCard } from "./view/SelectionCard.tsx";
import { ViewLayers } from "./view/ViewLayers.tsx";
import type { CardAction, MapControl } from "./view-options.ts";

type Props = {
  /** Where the map opens; absent = where this browser last left a map. */
  view?: MapView;
  /** A built-in map's id; absent = this browser's background map. */
  basemap?: string;
  /** Absent = this browser's overlay map. */
  overlay?: { source: string; opacity: number };
  dim?: boolean;
  mgrsGrid?: boolean;
  /** Every moving item's track; absent = as this browser has it. */
  tracks?: boolean;
  /** Absent = this browser's hidden overlay groups. */
  hiddenGroups?: ReadonlySet<string>;
  /** Shown besides the missions this browser shows. */
  missions?: readonly string[];
  /** The BattleLog layers shown, by layer event id; absent = this browser's choice. */
  eventLayers?: readonly string[];
  follow?: Follow;
  symbolScale?: number;
  controls: ReadonlySet<MapControl>;
  panZoom: boolean;
  /** Clicking selects an item and shows its card. */
  select: boolean;
  cardActions: ReadonlySet<CardAction>;
  /** Held outside, e.g. in a dashboard's URL so other widgets follow it. */
  selection?: Selection;
  onSelect?: (selection: Selection) => void;
  centreOnSelection: boolean;
  /** Answers a form's "Pick on map" request (see map-pick.ts). */
  answerPicks: boolean;
  onMap?: (map: MapLibreMap | undefined) => void;
};

/**
 * A read-only view of the TAK picture, set up by whoever placed it: what it
 * shows, which controls a viewer gets, and how it reacts. Changing TAK is the
 * Map page's job; "Open in Map" goes there with the same view and selection.
 */
export const TakMapView = ({
  view,
  basemap: basemapId,
  overlay: overlayConfig,
  dim,
  mgrsGrid,
  tracks: allTracks,
  hiddenGroups,
  missions: extraMissions = [],
  eventLayers: fixedEventLayers,
  follow,
  symbolScale = 1,
  controls,
  panZoom,
  select,
  cardActions,
  selection,
  onSelect,
  centreOnSelection,
  answerPicks,
  onMap,
}: Props) => {
  useTakSession();
  const picture = useTakItems();
  const takTracks = useTakTracks();
  const status = useTakStatus();
  const callsign = useCallsign();
  const selfUid = takSender(callsign).uid;
  const liveItems = picture.filter((i) => i.uid !== selfUid);
  const settings = useMapSettings();
  // Identity only, never a position: TAK routes Data Sync updates to whoever announces themselves.
  useEffect(() => {
    setTakPresence(
      callsign ? { ...takSender(callsign), team: settings.team, role: settings.role } : undefined,
    );
  }, [callsign, settings.team, settings.role]);
  const sources = useMapSources(settings.customSources, callsign ? selfUid : undefined);
  const sourceById = (id: string | null | undefined) => sources.find((s) => s.id === id);

  // What a viewer changes with the layer toggles lasts until they leave the page.
  const [ownBasemap, setOwnBasemap] = useState<string>();
  const [ownHidden, setOwnHidden] = useState<ReadonlySet<string>>();
  const [ownLayers, setOwnLayers] = useState<ReadonlySet<string>>();
  const basemap =
    sourceById(ownBasemap ?? basemapId) ??
    sourceById(settings.basemap) ??
    (sourceById(DEFAULT_BASEMAP) as MapSource);
  const overlaySource = sourceById(overlayConfig ? overlayConfig.source : settings.overlay);
  const overlayOpacity = overlayConfig?.opacity ?? settings.overlayOpacity;
  const hidden = ownHidden ?? hiddenGroups ?? settings.hidden;
  const shownLayerIds =
    ownLayers ?? (fixedEventLayers ? new Set(fixedEventLayers) : settings.shownEventLayers);

  const shownMissions = new Set([
    ...settings.shownMissions,
    ...extraMissions,
    ...(follow?.mission ? [follow.mission] : []),
  ]);
  const clientUid = callsign ? selfUid : undefined;
  useMissionsSync([...shownMissions], clientUid);
  useMissionSubscriptions([...shownMissions], clientUid);
  const missions = useMissions();

  const { selectedUid, selectedEventId, selectedOutside, selectUid, selectEvent, pendingCentre } =
    useSelection({ selection, onSelect, centreOnSelection });
  const { eventLayers, shownLayers, onLayerEvents, eventFeatures, selectedEvent } =
    useShownEventLayers({ shownLayerIds, replayAt: undefined, selectedEventId });
  const { items, currentItem } = workspacePicture({
    replaying: false,
    replayItems: undefined,
    selfUid,
    liveItems,
    missions,
    shownMissions,
    activePlan: undefined,
  });
  const selected = selectedUid ? currentItem(selectedUid) : undefined;

  const mapRef = useRef<MapLibreMap>(undefined);
  const [map, setMap] = useState<MapLibreMap>();
  const mapControls =
    map?.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-top-right") ?? undefined;
  const [cursor] = useState(createCursor);
  const ownPosition = useOwnPosition(map, undefined);
  const pickRequest = usePickRequest(answerPicks);
  const [chooser, setChooser] = useState<{ uids: string[]; at: { x: number; y: number } }>();
  const [logging, setLogging] = useState<{ item: TakItem; at: number }>();
  const now = useNow(30_000);

  // A viewer moving the map takes it over from following until they give it back.
  const [followPaused, setFollowPaused] = useState(false);
  const following = !!follow && !followPaused;
  const followMissionUids = new Set(
    missions.missions?.find((m) => m.name === follow?.mission)?.itemUids,
  );
  useFollow(
    map,
    following && follow ? positionsOf(followedItems(items, follow, followMissionUids)) : [],
  );
  useEffect(() => {
    if (!map || !follow) return;
    const onMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) setFollowPaused(true);
    };
    map.on("movestart", onMove);
    return () => {
      map.off("movestart", onMove);
    };
  }, [map, follow]);

  const flyTo = (position: Position) => mapRef.current && flyToPosition(mapRef.current, position);
  const centreOn = (item: TakItem) => mapRef.current && centreOnItem(mapRef.current, item);
  const goTo = (position: Position) => {
    if (follow) setFollowPaused(true);
    flyTo(position);
  };
  const pick = (item: TakItem) => {
    setChooser(undefined);
    if (follow) setFollowPaused(true);
    if (select) selectUid(item.uid);
    centreOn(item);
  };

  useCentreWhenReady(pendingCentre, (target) => {
    if (!mapRef.current) return false;
    const item = target.tak ? currentItem(target.tak) : undefined;
    const point =
      target.event && selectedEvent?.eventId === target.event && selectedEvent?.locationPoint;
    if (item) centreOn(item);
    else if (point) flyTo([point.lng, point.lat]);
    return !!(item || point);
  });

  const openInMapHref = (target: Selection = {}) => {
    const params = new URLSearchParams();
    if (map) params.set("at", viewParam(viewOf(map)));
    if (target.tak) params.set("tak", target.tak);
    if (target.event) params.set("event", target.event);
    return `/map?${params}`;
  };

  // An outside selection is only highlighted: a card would cover the map it's shown on.
  const card =
    select && !selectedOutside && selected ? (
      <SelectionCard
        item={selected}
        actions={cardActions}
        coordFormat={settings.coordFormat}
        now={now}
        onCentre={hasPosition(selected) ? () => centreOn(selected) : undefined}
        onLog={() => setLogging({ item: selected, at: Date.now() })}
        openInMapHref={openInMapHref({ tak: selected.uid })}
        onClose={() => selectUid(undefined)}
      />
    ) : select && !selectedOutside && !selected && selectedEvent ? (
      <SelectionCard
        event={selectedEvent}
        actions={cardActions}
        coordFormat={settings.coordFormat}
        now={now}
        onCentre={
          selectedEvent.locationPoint
            ? () => {
                const point = selectedEvent.locationPoint;
                if (point) flyTo([point.lng, point.lat]);
              }
            : undefined
        }
        openInMapHref={openInMapHref({ event: selectedEvent.eventId })}
        onClose={() => selectEvent(undefined)}
      />
    ) : undefined;

  const showTracks = allTracks ?? settings.showAllTracks;
  const passive = !select && !pickRequest;

  return (
    <div className="tak-view" data-picking={!!pickRequest || undefined}>
      <MapCanvas
        // The zoom buttons are added when the map is made.
        key={controls.has("zoom") ? "zoom" : "no-zoom"}
        cursor={cursor}
        items={items}
        tracks={trackFeatures(showTracks ? items : [], takTracks, hidden)}
        hidden={hidden}
        basemap={basemap}
        overlay={overlaySource && { source: overlaySource, opacity: overlayOpacity }}
        dim={dim ?? settings.dim}
        mgrsGrid={mgrsGrid ?? settings.mgrsGrid}
        selectedUids={selectedUid ? [selectedUid] : []}
        onPick={({ uids, eventIds, at, position }) => {
          if (pickRequest) return answerPick(position);
          if (!select) return;
          setChooser(uids.length > 1 ? { uids, at } : undefined);
          if (!uids.length && eventIds[0]) return selectEvent(eventIds[0]);
          selectUid(uids.length > 1 ? selectedUid : uids[0]);
          if (!uids.length) selectEvent(undefined);
        }}
        onReady={(ready) => {
          mapRef.current = ready;
          setMap(ready);
          onMap?.(ready);
        }}
        view={view}
        zoomButtons={controls.has("zoom")}
        panZoom={panZoom}
        passive={passive}
        symbolScale={symbolScale}
        events={eventFeatures}
        selectedEventId={selectedEventId}
      />
      <EventLayerFeeds layers={shownLayers} replayWindowMs={0} onEvents={onLayerEvents} />

      {mapControls &&
        createPortal(
          <div className="maplibregl-ctrl tak-map-buttons">
            {controls.has("locate") && (
              <ActionIcon
                variant="default"
                size="md"
                aria-label="Locate me"
                title="Locate me (shown only to you)"
                aria-pressed={ownPosition.locating}
                onClick={() => {
                  if (follow) setFollowPaused(true);
                  ownPosition.toggleLocate();
                }}
              >
                <IconCurrentLocation size={18} />
              </ActionIcon>
            )}
            {controls.has("layers") && (
              <ViewLayers
                sources={sources}
                basemap={basemap}
                onBasemap={setOwnBasemap}
                hidden={hidden}
                onHidden={setOwnHidden}
                layers={eventLayers ?? []}
                shownLayers={shownLayerIds}
                onShownLayers={setOwnLayers}
              />
            )}
            {controls.has("openInMap") && (
              <ActionIcon
                variant="default"
                size="md"
                component="a"
                href={openInMapHref({ tak: selectedUid, event: selectedEventId })}
                target="_blank"
                aria-label="Open in Map"
                title="Open this view on the Map page"
              >
                <IconExternalLink size={18} />
              </ActionIcon>
            )}
          </div>,
          mapControls,
        )}

      <div className="tak-overlay">
        {controls.has("search") && (
          <div className="tak-search-slot">
            <SearchBox
              items={items}
              coordFormat={settings.coordFormat}
              onPickItem={pick}
              onGoTo={goTo}
            />
          </div>
        )}
        <div className="tak-banners">
          <EmergencyBanner items={liveItems} map={map} onCenter={passive ? undefined : pick} />
          {pickRequest && (
            <Alert variant="filled" icon={<IconCrosshair size={18} />}>
              <Group justify="space-between" wrap="nowrap">
                <Text fz="sm">Click the map to set: {pickRequest.label}</Text>
                <Button size="compact-xs" variant="white" onClick={cancelPick}>
                  Cancel
                </Button>
              </Group>
            </Alert>
          )}
        </div>
      </div>

      {chooser && (
        <PickChooser
          items={chooser.uids.flatMap((uid) => items.find((i) => i.uid === uid) ?? [])}
          at={chooser.at}
          onPick={(item) => {
            setChooser(undefined);
            selectUid(item.uid);
          }}
          onClose={() => setChooser(undefined)}
        />
      )}

      <div className="tak-view-bottom">
        {follow && followPaused && (
          <Button
            size="compact-sm"
            variant="default"
            leftSection={<IconPlayerPlay size={14} />}
            onClick={() => setFollowPaused(false)}
            className="tak-view-resume"
          >
            Resume following
          </Button>
        )}
        {card}
        {controls.has("status") && (
          <span className="tak-view-status" data-connection={status.connection} role="status">
            {CONNECTION_TEXT[status.connection]}
          </span>
        )}
      </div>

      {logging && (
        <LogItemDialog item={logging.item} at={logging.at} onClose={() => setLogging(undefined)} />
      )}
    </div>
  );
};
