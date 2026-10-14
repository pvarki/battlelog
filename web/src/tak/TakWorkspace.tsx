import "./tak.css";
import {
  ActionIcon,
  Alert,
  Button,
  CloseButton,
  Drawer,
  Group,
  Indicator,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
  IconAddressBook,
  IconChecklist,
  IconClipboardList,
  IconCurrentLocation,
  IconFolders,
  IconHistory,
  IconList,
  IconMessage,
  IconPencil,
  IconPlugConnectedX,
  IconSettings,
  IconStack2,
} from "@tabler/icons-react";
import { type Map as MapLibreMap, Marker } from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ACCENT } from "../theme.ts";
import { useIsMobile } from "../viewport.ts";
import { ChatDrawer } from "./chat/ChatDrawer.tsx";
import { type ChatRoom, directRoom, newChatEvent } from "./chat/chat.ts";
import { useChatMessages } from "./chat/store.ts";
import { ChecklistsDrawer } from "./checklists/ChecklistsDrawer.tsx";
import { deleteEvent } from "./commands.ts";
import { ContactsDrawer } from "./contacts/ContactsDrawer.tsx";
import { recipientGroups } from "./contacts/SendTo.tsx";
import { type Position, type TakItem, toChange } from "./cot.ts";
import { sendTestMarker } from "./dev-test-write.ts";
import { DrawToolbar, UndoButton } from "./drawing/DrawToolbar.tsx";
import { editGeometryEvent, editTarget } from "./drawing/edit-geometry.ts";
import { MeasurePanel } from "./drawing/MeasurePanel.tsx";
import { centreOfItems, movedEvent, offsetBetween } from "./drawing/move-items.ts";
import { newRangeBearingEvent } from "./drawing/new-items.ts";
import { defaultRingsLook } from "./drawing/RingsDialog.tsx";
import { SelectionPanel } from "./drawing/SelectionPanel.tsx";
import { type Drawn, TOOLS, useDrawing } from "./drawing/useDrawing.ts";
import { useDrawingWorkflow } from "./drawing/useDrawingWorkflow.tsx";
import { useMeasure } from "./drawing/useMeasure.ts";
import { EmergencyBanner } from "./emergency/EmergencyBanner.tsx";
import { EventDetails } from "./event-layers/EventDetails.tsx";
import { EventLayerFeeds } from "./event-layers/EventLayerFeeds.tsx";
import { EventLayersSection } from "./event-layers/EventLayersSection.tsx";
import { useShownEventLayers } from "./event-layers/useShownEventLayers.ts";
import { takSender, useCallsign } from "./identity.ts";
import { useInbox } from "./inbox/store.ts";
import { ItemDetails } from "./items/ItemDetails.tsx";
import { ItemsDrawer } from "./items/ItemsDrawer.tsx";
import { labelOf } from "./items.ts";
import { DEFAULT_BASEMAP, type MapSource, useMapSources } from "./map/basemaps.ts";
import { centreOnItem, flyToPosition } from "./map/camera.ts";
import { createCursor } from "./map/cursor.ts";
import { LayersDrawer } from "./map/LayersDrawer.tsx";
import { MapCanvas } from "./map/MapCanvas.tsx";
import { MapImageButton } from "./map/MapImageButton.tsx";
import { PickChooser } from "./map/PickChooser.tsx";
import { MissionsDrawer } from "./missions/MissionsDrawer.tsx";
import { useMissions, useMissionsSync } from "./missions/store.ts";
import { useMissionSubscriptions } from "./missions/writes.ts";
import { draftItems, workspacePicture } from "./picture.ts";
import { PlansDrawer } from "./plans/PlansDrawer.tsx";
import { usePlans } from "./plans/plans.ts";
import { OwnPositionPanel } from "./position/OwnPositionPanel.tsx";
import { useOwnPosition } from "./position/useOwnPosition.ts";
import { ReplayBanner, ReplayBar } from "./replay/ReplayBar.tsx";
import { DEFAULT_REPLAY_WINDOW_MS, useReplay } from "./replay/useReplay.ts";
import { SearchBox } from "./SearchBox.tsx";
import { SettingsDrawer } from "./SettingsDrawer.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { StatusBar } from "./StatusBar.tsx";
import {
  holdPositionSharing,
  loadTrack,
  sendCot,
  setTakPresence,
  type TakStatus,
  useTakItems,
  useTakSession,
  useTakStatus,
  useTakTracks,
} from "./session.ts";
import { useMapSettings } from "./settings.ts";
import type { MapView } from "./tools.ts";
import { trackFeatures } from "./tracks.ts";
import { describeStep } from "./undo.ts";
import { type Selection, useCentreWhenReady, useSelection } from "./use-selection.ts";
import { useTakWrites } from "./use-tak-writes.ts";

const DRAWERS = {
  items: { label: "Items", Icon: IconList, key: "1" },
  missions: { label: "Data Sync", Icon: IconFolders, key: "2" },
  plans: { label: "Plans", Icon: IconClipboardList, key: "3" },
  layers: { label: "Layers", Icon: IconStack2, key: "4" },
  chat: { label: "Chat", Icon: IconMessage, key: "5" },
  contacts: { label: "Contacts", Icon: IconAddressBook, key: "6" },
  checklists: { label: "Checklists", Icon: IconChecklist, key: "7" },
  settings: { label: "Settings", Icon: IconSettings, key: "8" },
} as const;

type DrawerId = keyof typeof DRAWERS;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const ConnectionBanner = ({ status }: { status: TakStatus }) => {
  if (status.connection !== "down") return null;
  return (
    // Amber and outlined: filled red is kept for emergencies, which must stand out above this.
    <Alert color="warning" variant="outline" icon={<IconPlugConnectedX size={18} />}>
      {status.everConnected
        ? "Connection to TAK lost — reconnecting. The map shows the last known picture."
        : "Can't connect to TAK. Open BattleLog from the deploy app so your device certificate is used. TAK may also be unreachable."}
    </Alert>
  );
};

const Panel = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <Stack gap="xs" h="100%">
    <Group justify="space-between">
      <Text fw={600} fz="sm">
        {title}
      </Text>
      <CloseButton size="sm" onClick={onClose} aria-label={`Close ${title}`} />
    </Group>
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
  </Stack>
);

type Props = {
  /** Where the map opens, e.g. from an "Open in Map" link; absent = where this browser left it. */
  view?: MapView;
  /** Held in the page's URL, so a link can open the map on something. */
  selection?: Selection;
  onSelect?: (selection: Selection) => void;
};

/**
 * The TAK client on the Map page: map, item list, layers, drawing and item
 * details around one shared TAK session. Dashboards show `TakMapView` instead.
 */
export const TakWorkspace = ({ view, selection, onSelect }: Props) => {
  const drawers = Object.keys(DRAWERS) as DrawerId[];
  useTakSession();
  const picture = useTakItems();
  const tracks = useTakTracks();
  const [trackedUids, setTrackedUids] = useState<ReadonlySet<string>>(new Set());
  const status = useTakStatus();
  const callsign = useCallsign();
  // Other tabs announce this same user; BattleLog never lists itself.
  const liveItems = picture.filter((i) => i.uid !== takSender(callsign).uid);
  const settings = useMapSettings();
  const clientUid = callsign ? takSender(callsign).uid : undefined;
  const mapSources = useMapSources(settings.customSources, clientUid);
  const sourceById = (id: string | null) => mapSources.find((s) => s.id === id);
  const basemap = sourceById(settings.basemap) ?? (sourceById(DEFAULT_BASEMAP) as MapSource);
  const overlaySource = sourceById(settings.overlay);
  const hidden = settings.hidden;
  const shownMissions = new Set(settings.shownMissions);
  const isMobile = useIsMobile();
  const [drawer, setDrawer] = useState<DrawerId | null>(isMobile ? null : "items");
  const {
    selectedUid,
    selectedEventId,
    selectUid: setSelectedUid,
    selectEvent,
    pendingCentre,
  } = useSelection({ selection, onSelect });
  const [chooser, setChooser] = useState<{ uids: string[]; at: { x: number; y: number } }>();
  const [openMission, setOpenMission] = useState<string>();
  const browsedMission = drawer === "missions" ? openMission : undefined;
  useMissionsSync([...shownMissions, ...(browsedMission ? [browsedMission] : [])], clientUid);
  useMissionSubscriptions([...shownMissions], clientUid);
  const missions = useMissions();
  const plans = usePlans();
  const activePlan = plans.plans.find((p) => p.id === plans.activeId);
  const replay = useReplay();
  const replaying = replay.windowMs !== undefined;
  const replayFrame = replaying ? replay.frame : undefined;
  const replayReason = replaying ? "Replaying history: go back to live to change TAK" : undefined;
  const shownLayerIds = settings.shownEventLayers;
  const {
    eventLayers,
    shownLayers,
    layerEvents,
    onLayerEvents,
    eventFeatures,
    selectedEvent,
    truncatedLayers,
  } = useShownEventLayers({ shownLayerIds, replayAt: replayFrame?.at, selectedEventId });
  const { items, missionItem, currentItem } = workspacePicture({
    replaying,
    replayItems: replayFrame?.items,
    selfUid: takSender(callsign).uid,
    liveItems,
    missions,
    shownMissions,
    activePlan,
  });
  const { submitAll, submit, readOnlyReason, canChange, latestStep, undoReason, undo } =
    useTakWrites({
      activePlan,
      plans: plans.plans,
      liveItems,
      missionItem,
      replaying,
      replayReason,
      callsign,
      connection: status.connection,
    });
  const submitLabel = activePlan ? `Add to ${activePlan.name}` : "Save to TAK";
  const mapRef = useRef<MapLibreMap>(undefined);
  const [map, setMap] = useState<MapLibreMap>();
  // Locate and Replay sit in MapLibre's own control stack, under zoom and compass whatever their size.
  const mapControls =
    map?.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-top-right") ?? undefined;
  const drawing = useDrawing(map);
  const [cursor] = useState(createCursor);
  const measure = useMeasure(map, cursor);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = selectedUid ? currentItem(selectedUid) : undefined;
  const [grouped, setGrouped] = useState<ReadonlySet<string>>(new Set());
  const [lassoing, setLassoing] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [movingGroup, setMovingGroup] = useState(false);
  const groupItems = items.filter((i) => grouped.has(i.uid));
  const movableItems = groupItems.filter((i) => canChange(i) && editTarget(i));
  const deletableItems = groupItems.filter(canChange);
  /** The item selected on its own becomes the first of the group. */
  const groupBase = () => new Set(grouped.size || !selectedUid ? grouped : [selectedUid]);
  const toggleGrouped = (uid: string) => {
    const next = groupBase();
    if (!next.delete(uid)) next.add(uid);
    setGrouped(next);
    setSelectedUid(undefined);
  };
  const addToGroup = (uids: string[]) => {
    setGrouped(new Set([...groupBase(), ...uids]));
    setSelectedUid(undefined);
  };
  const clearGroup = () => {
    setGrouped(new Set());
    setMovingGroup(false);
  };
  const moveGroupTo = (target: Position) => {
    const by = offsetBetween(centreOfItems(movableItems), target);
    submitAll(movableItems.map((item) => movedEvent(item, by)));
    setMovingGroup(false);
  };
  const contacts = recipientGroups(
    liveItems.filter((i) => i.team && i.callsign && i.callsign !== callsign),
  );
  const sendReason = !callsign
    ? "No callsign: open BattleLog from the deploy app to draw on TAK"
    : status.connection !== "live"
      ? "Not connected to TAK"
      : undefined;
  const drawReason = replayReason ?? sendReason;
  const sender = takSender(callsign);
  // Mission, plan and group controls write to TAK directly: none of them while replaying.
  const writerUid = callsign && !replaying ? sender.uid : undefined;
  const chatMessages = useChatMessages();
  // Remembered across reloads now that chat is: a restored message read yesterday stays read.
  // Closed by default: most time on the map is spent watching it, not drawing on it.
  const [drawOpen, setDrawOpen] = useLocalStorage({
    key: "battlelog.tak.drawOpen",
    defaultValue: false,
  });
  const [chatReadAt, setChatReadAt] = useLocalStorage({
    key: "battlelog.tak.chatReadAt",
    defaultValue: 0,
  });
  const newestChat = chatMessages.at(-1)?.time ?? 0;
  const unreadChats =
    drawer === "chat"
      ? 0
      : chatMessages.filter((m) => m.time > chatReadAt && m.senderUid !== sender.uid).length;
  useEffect(() => {
    if (drawer === "chat" && newestChat > chatReadAt) setChatReadAt(newestChat);
  }, [drawer, newestChat, chatReadAt, setChatReadAt]);
  const [chatWith, setChatWith] = useState<ChatRoom>();
  const sharing = settings.sharePosition && !!callsign;
  useEffect(() => {
    const self = takSender(callsign);
    setTakPresence(callsign ? { ...self, team: settings.team, role: settings.role } : undefined);
  }, [callsign, settings.team, settings.role]);
  useEffect(() => (sharing ? holdPositionSharing() : undefined), [sharing]);
  const ownPosition = useOwnPosition(
    map,
    settings.sharePosition && callsign
      ? { ...sender, team: settings.team, role: settings.role }
      : undefined,
  );
  const receivedPackages = useInbox().length;
  const badges: Partial<Record<DrawerId, number>> = {
    chat: unreadChats,
    plans: receivedPackages,
  };
  const chatContacts = liveItems
    .flatMap((i) =>
      i.team && i.callsign && i.callsign !== callsign
        ? [{ uid: i.uid, callsign: i.callsign, team: i.team }]
        : [],
    )
    .sort((a, b) => a.callsign.localeCompare(b.callsign));
  const nameFor = (label: string) =>
    `${label} ${liveItems.filter((i) => i.callsign?.startsWith(`${label} `)).length + 1}`;
  const {
    previewOf: drawingPreview,
    dialog: drawingDialog,
    setTacticalLook,
    setRingsLook,
  } = useDrawingWorkflow({ drawing, sender, nameFor, submit, submitLabel });
  const movedPreview = (target: Position) => {
    const by = offsetBetween(centreOfItems(movableItems), target);
    return movableItems.flatMap((item) => {
      const change = toChange(movedEvent(item, by));
      return change?.kind === "upsert" ? [change.item] : [];
    });
  };
  const previewOf = (sketch: Drawn | undefined, cursor: Position | undefined): TakItem[] =>
    movingGroup ? (cursor ? movedPreview(cursor) : []) : drawingPreview(sketch, cursor);
  const callsignOf = (uid: string) => liveItems.find((i) => i.uid === uid)?.callsign;
  const missionsOf = (uid: string) =>
    (missions.missions ?? []).filter((m) => m.itemUids.includes(uid)).map((m) => m.name);

  const flyTo = (position: Position) => mapRef.current && flyToPosition(mapRef.current, position);

  // A searched coordinate keeps a pin until the next search, Esc, or a click on it.
  const goToPin = useRef<Marker>(undefined);
  const clearGoToPin = () => {
    goToPin.current?.remove();
    goToPin.current = undefined;
  };
  const goTo = (position: Position) => {
    flyTo(position);
    clearGoToPin();
    const map = mapRef.current;
    if (!map) return;
    const pin = new Marker({ color: ACCENT }).setLngLat(position).addTo(map);
    pin.getElement().title = "Searched coordinate: click to remove";
    pin.getElement().addEventListener("click", clearGoToPin);
    goToPin.current = pin;
  };

  const centreOn = (item: TakItem) => mapRef.current && centreOnItem(mapRef.current, item);
  const busy = !!(drawing.tool || drawing.editing || measure.active);

  useCentreWhenReady(pendingCentre, (target) => {
    if (!mapRef.current) return false;
    const item = target.tak ? currentItem(target.tak) : undefined;
    const point =
      target.event && selectedEvent?.eventId === target.event && selectedEvent?.locationPoint;
    if (item) centreOn(item);
    else if (point) flyTo([point.lng, point.lat]);
    return !!(item || point);
  });

  const pick = (item: TakItem) => {
    clearGroup();
    setSelectedUid(item.uid);
    centreOn(item);
    if (isMobile) setDrawer(null);
  };

  const toggleTrack = (uid: string) => {
    const next = new Set(trackedUids);
    if (next.delete(uid)) return setTrackedUids(next);
    setTrackedUids(next.add(uid));
    void loadTrack(uid);
  };

  // Whatever is under way keeps its tools in view, whether or not they were opened.
  const toolbarShown =
    drawOpen ||
    !!drawing.tool ||
    !!drawing.editing ||
    measure.active ||
    lassoing ||
    movingGroup ||
    grouped.size > 0;
  /** Closing the tools ends what they were doing, as Esc would; a drawn shape awaiting its dialog stays. */
  const toggleDrawing = () => {
    if (!toolbarShown) return setDrawOpen(true);
    setDrawOpen(false);
    measure.stop();
    setLassoing(false);
    clearGroup();
    if (drawing.editing || !drawing.drawn) drawing.clear();
  };

  const toggleDrawer = (id: DrawerId) => {
    setChatWith(undefined);
    setDrawer((open) => (open === id ? null : id));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog owns its keys, Esc included: closing one mustn't also clear the map.
      if (
        e.defaultPrevented ||
        (e.target instanceof Element && e.target.closest('[role="dialog"]'))
      )
        return;
      if (e.key === "Escape") {
        if (chooser) setChooser(undefined);
        else if (goToPin.current) clearGoToPin();
        else if (measure.active) measure.stop();
        else if (drawing.editing) drawing.clear();
        else if (drawing.tool && !drawing.drawn) drawing.clear();
        else if (movingGroup) setMovingGroup(false);
        else if (lassoing) setLassoing(false);
        else if (grouped.size) clearGroup();
        else if (selectedUid) setSelectedUid(undefined);
        else if (selectedEventId) selectEvent(undefined);
        else setDrawer(null);
        return;
      }
      if (isTyping(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setDrawOpen(true);
        undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "?") setShowShortcuts((open) => !open);
      if (e.key.toLowerCase() === "d") toggleDrawing();
      if (e.key.toLowerCase() === "c" && selected) centreOn(selected);
      if (e.key.toLowerCase() === "c" && selectedEvent?.locationPoint)
        flyTo([selectedEvent.locationPoint.lng, selectedEvent.locationPoint.lat]);
      for (const id of drawers) {
        if (e.key === DRAWERS[id].key) toggleDrawer(id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const drawerContent = (id: DrawerId) =>
    id === "chat" ? (
      <ChatDrawer
        messages={chatMessages}
        selfUid={sender.uid}
        contacts={chatContacts}
        sendReason={sendReason}
        team={settings.team}
        onSend={(text, room) => sendCot(newChatEvent(text, room, sender))}
        initialRoom={chatWith}
      />
    ) : id === "contacts" ? (
      <ContactsDrawer
        contacts={liveItems.filter((i) => i.team && i.uid !== sender.uid)}
        selfUid={sender.uid}
        map={map}
        ownPosition={ownPosition.fix?.position}
        onCenter={pick}
        onChat={(contact) => {
          setChatWith(directRoom(contact.uid, contact.callsign ?? contact.uid));
          setDrawer("chat");
        }}
      >
        <OwnPositionPanel
          settings={settings}
          shareReason={
            callsign ? undefined : "No callsign: open BattleLog from the deploy app to share"
          }
          error={ownPosition.error}
        />
      </ContactsDrawer>
    ) : id === "plans" ? (
      <PlansDrawer
        state={plans}
        draftsOf={(plan) => draftItems(plan, liveItems)}
        selectedUid={selectedUid}
        onPick={pick}
        publishReason={drawReason}
        sender={sender}
        contacts={contacts}
        missions={missions.missions ?? []}
        clientUid={writerUid}
      />
    ) : id === "checklists" ? (
      <ChecklistsDrawer writer={callsign ? sender : undefined} />
    ) : id === "missions" ? (
      <MissionsDrawer
        state={missions}
        shown={settings.shownMissions}
        onToggleShown={settings.toggleMission}
        open={openMission}
        onOpen={setOpenMission}
        selectedUid={selectedUid}
        onPick={pick}
        callsignOf={callsignOf}
        clientUid={writerUid}
      />
    ) : id === "items" ? (
      <ItemsDrawer
        items={items}
        selectedUid={selectedUid}
        onPick={pick}
        grouped={grouped}
        onToggleGrouped={busy ? undefined : (item) => toggleGrouped(item.uid)}
        hidden={settings.hidden}
        onToggleGroup={settings.toggleGroup}
      />
    ) : id === "layers" ? (
      <LayersDrawer
        settings={settings}
        sources={mapSources}
        map={map}
        basemap={basemap}
        eventLayers={
          <EventLayersSection
            layers={eventLayers}
            shown={shownLayerIds}
            onToggle={settings.toggleEventLayer}
            truncated={truncatedLayers}
          />
        }
      />
    ) : (
      <SettingsDrawer settings={settings} clientUid={writerUid}>
        {import.meta.env.DEV && callsign && (
          <Button
            size="xs"
            variant="default"
            onClick={() => {
              const center = mapRef.current?.getCenter();
              if (center) void sendTestMarker([center.lng, center.lat], callsign);
            }}
          >
            Dev: send test marker at map centre
          </Button>
        )}
      </SettingsDrawer>
    );

  const undoButton = (
    <UndoButton
      subject={latestStep && describeStep(latestStep)}
      destination={activePlan ? `plan ${activePlan.name}` : "TAK"}
      disabledReason={undoReason}
      onUndo={undo}
    />
  );

  const eventPoint = selectedEvent?.locationPoint;
  const eventDetails = !selected && selectedEvent && (
    <EventDetails
      key={selectedEvent.eventId}
      event={selectedEvent}
      layerNames={shownLayers
        .filter((l) =>
          layerEvents.get(l.eventId)?.events.some((e) => e.eventId === selectedEvent.eventId),
        )
        .map((l) => l.definition.name)}
      coordFormat={settings.coordFormat}
      onCenter={eventPoint ? () => flyTo([eventPoint.lng, eventPoint.lat]) : undefined}
      onClose={() => selectEvent(undefined)}
    />
  );

  const details = selected && (
    <ItemDetails
      key={selected.uid}
      item={selected}
      coordFormat={settings.coordFormat}
      missions={missionsOf(selected.uid)}
      allMissions={missions.missions ?? []}
      clientUid={writerUid}
      readOnlyReason={readOnlyReason(selected)}
      callsign={callsign}
      contacts={contacts}
      sendReason={drawReason}
      onSubmit={submit}
      submitLabel={submitLabel}
      onEditShape={
        editTarget(selected)
          ? () => {
              // The details sheet would cover the map being edited.
              if (drawing.edit(selected) && isMobile) setSelectedUid(undefined);
            }
          : undefined
      }
      planActive={!!activePlan}
      tracking={settings.showAllTracks || trackedUids.has(selected.uid)}
      onToggleTrack={settings.showAllTracks ? undefined : () => toggleTrack(selected.uid)}
      replayAt={replayFrame?.at}
      onOpenEvent={selectEvent}
      items={items}
      onSelectItem={setSelectedUid}
      onCenter={() => centreOn(selected)}
      onClose={() => setSelectedUid(undefined)}
    />
  );

  return (
    <div className="tak-workspace" data-mobile={isMobile || undefined}>
      <nav className="tak-rail" aria-label="Map tools">
        {drawers.map((id) => {
          const { label, Icon, key } = DRAWERS[id];
          return (
            <UnstyledButton
              key={id}
              className="tak-rail-button"
              data-end={id === "settings" || undefined}
              aria-pressed={drawer === id}
              onClick={() => toggleDrawer(id)}
              title={`${label} (${key})`}
            >
              <Indicator label={badges[id]} size={16} color="primary" disabled={!badges[id]}>
                <Icon size={20} stroke={1.5} />
              </Indicator>
              <span>{label}</span>
            </UnstyledButton>
          );
        })}
      </nav>

      {!isMobile && drawer && (
        <aside className="tak-drawer" aria-label={DRAWERS[drawer].label}>
          <Panel title={DRAWERS[drawer].label} onClose={() => setDrawer(null)}>
            {drawerContent(drawer)}
          </Panel>
        </aside>
      )}

      <div className="tak-main">
        <MapCanvas
          cursor={cursor}
          preview={{ sketch: drawing.sketch, build: previewOf }}
          items={items.filter((i) => i.uid !== drawing.editing?.uid)}
          tracks={trackFeatures(
            settings.showAllTracks ? items : items.filter((i) => trackedUids.has(i.uid)),
            replayFrame?.tracks ?? tracks,
            hidden,
          )}
          hidden={hidden}
          basemap={basemap}
          overlay={overlaySource && { source: overlaySource, opacity: settings.overlayOpacity }}
          dim={settings.dim}
          mgrsGrid={settings.mgrsGrid}
          selectedUids={[...(selectedUid ? [selectedUid] : []), ...grouped]}
          onPick={({ uids, eventIds, at, position, shift }) => {
            if (movingGroup) return moveGroupTo(position);
            if (busy) return;
            if (shift) {
              if (uids[0]) toggleGrouped(uids[0]);
              return;
            }
            clearGroup();
            setChooser(uids.length > 1 ? { uids, at } : undefined);
            if (!uids.length && eventIds[0]) return selectEvent(eventIds[0]);
            setSelectedUid(uids.length > 1 ? selectedUid : uids[0]);
            if (!uids.length) selectEvent(undefined);
          }}
          onBoxSelect={!busy && !movingGroup ? addToGroup : undefined}
          onLasso={lassoing && !busy && !movingGroup ? addToGroup : undefined}
          onReady={(ready) => {
            mapRef.current = ready;
            setMap(ready);
          }}
          view={view}
          // An "Open in Map" link moves this map like any other visit would.
          rememberView
          replayAt={replayFrame?.at}
          events={eventFeatures}
          selectedEventId={selectedEventId}
        />
        <EventLayerFeeds
          layers={shownLayers}
          replayWindowMs={replay.windowMs ?? 0}
          onEvents={onLayerEvents}
        />
        {mapControls &&
          createPortal(
            <div className="maplibregl-ctrl tak-map-buttons">
              <ActionIcon
                className="tak-locate"
                variant="default"
                size="md"
                aria-label="Locate me"
                title="Locate me (shown only to you)"
                aria-pressed={ownPosition.locating}
                onClick={ownPosition.toggleLocate}
              >
                <IconCurrentLocation size={18} />
              </ActionIcon>
              <ActionIcon
                className="tak-replay"
                variant="default"
                size="md"
                aria-label="Replay history"
                title="Replay history"
                aria-pressed={replaying}
                onClick={() => {
                  if (replaying) return replay.stop();
                  drawing.clear();
                  measure.stop();
                  replay.setWindowMs(DEFAULT_REPLAY_WINDOW_MS);
                }}
              >
                <IconHistory size={18} />
              </ActionIcon>
              {map && <MapImageButton map={map} coordFormat={settings.coordFormat} />}
            </div>,
            mapControls,
          )}
        <ShortcutsDialog
          opened={showShortcuts}
          onClose={() => setShowShortcuts(false)}
          drawers={[...drawers.map((id) => DRAWERS[id]), { label: "the drawing tools", key: "D" }]}
        />
        <div className="tak-overlay">
          {/* Search and draw together: the tools open right under the button that opens them. */}
          <div className="tak-command-row">
            <div className="tak-search-slot">
              <SearchBox
                ref={searchRef}
                items={items}
                coordFormat={settings.coordFormat}
                onPickItem={pick}
                onGoTo={goTo}
              />
            </div>
            <UnstyledButton
              className="tak-draw-toggle"
              aria-pressed={toolbarShown}
              aria-label="Drawing tools"
              onClick={toggleDrawing}
              title="Drawing tools (D)"
            >
              <IconPencil size={18} stroke={1.5} />
              {!isMobile && <span>Draw</span>}
            </UnstyledButton>
          </div>
          <div className="tak-banners">
            <EmergencyBanner items={liveItems} map={map} onCenter={pick} />
            {replaying && <ReplayBanner replay={replay} />}
            <ConnectionBanner status={status} />
          </div>
          {toolbarShown && (
            <DrawToolbar
              tool={drawing.tool}
              onChoose={(tool) => {
                measure.stop();
                setLassoing(false);
                drawing.choose(tool);
                if (tool === "rings" || tool === "bullseye")
                  setRingsLook(defaultRingsLook(nameFor(TOOLS[tool].label)));
              }}
              graphic={drawing.graphic}
              symbol={drawing.symbol}
              onChooseSymbol={(symbol) => {
                measure.stop();
                drawing.choose("marker", undefined, symbol);
              }}
              onChooseGraphic={(graphic) => {
                measure.stop();
                drawing.choose(graphic && (graphic.shape === "line" ? "line" : "polygon"), graphic);
                if (graphic)
                  setTacticalLook({
                    name: nameFor(graphic.name),
                    affiliation: "friendly",
                    remarks: "",
                  });
              }}
              disabledReason={activePlan ? replayReason : drawReason}
              planName={activePlan?.name}
              editing={
                drawing.editing && {
                  name: labelOf(drawing.editing),
                  saveLabel: submitLabel,
                  onCancel: drawing.clear,
                  onSave: () => {
                    const item = drawing.editing;
                    const edited = drawing.edited();
                    if (item && edited) submit(editGeometryEvent(item, edited));
                    drawing.clear();
                  },
                }
              }
              selection={
                groupItems.length > 0 ? (
                  <SelectionPanel
                    count={groupItems.length}
                    movable={movableItems.length}
                    deletable={deletableItems.length}
                    moving={movingGroup}
                    onMove={() => setMovingGroup(true)}
                    onCancelMove={() => setMovingGroup(false)}
                    onDelete={() => {
                      submitAll(deletableItems.map((item) => deleteEvent(item)));
                      clearGroup();
                    }}
                    onClear={clearGroup}
                    planName={activePlan?.name}
                  >
                    {undoButton}
                  </SelectionPanel>
                ) : undefined
              }
              undo={undoButton}
              measuring={measure.active}
              lassoing={lassoing}
              onToggleLasso={() => {
                measure.stop();
                drawing.choose(undefined);
                setLassoing(!lassoing);
              }}
              onToggleMeasure={() => {
                if (measure.active) return measure.stop();
                drawing.choose(undefined);
                measure.start();
              }}
            >
              <MeasurePanel
                points={measure.points}
                closed={measure.closed}
                onClosedChange={measure.setClosed}
                cursor={cursor}
                onClear={measure.clear}
                onSave={() => {
                  const [from, to] = measure.points;
                  if (from && to) submit(newRangeBearingEvent([from, to], nameFor("R&B")));
                  measure.stop();
                }}
                saveDisabledReason={activePlan ? replayReason : drawReason}
              />
            </DrawToolbar>
          )}
        </div>
        {replaying && <ReplayBar replay={replay} />}
        {chooser && (
          <PickChooser
            items={chooser.uids.flatMap((uid) => items.find((i) => i.uid === uid) ?? [])}
            at={chooser.at}
            onPick={(item) => {
              setChooser(undefined);
              setSelectedUid(item.uid);
            }}
            onClose={() => setChooser(undefined)}
          />
        )}
      </div>

      {!isMobile && (details || eventDetails) && (
        <aside className="tak-details" aria-label="Item details">
          {details || eventDetails}
        </aside>
      )}

      {isMobile && (
        <>
          <Drawer
            opened={drawer !== null}
            onClose={() => setDrawer(null)}
            position="bottom"
            size="70%"
            title={drawer ? DRAWERS[drawer].label : undefined}
          >
            {drawer && drawerContent(drawer)}
          </Drawer>
          <Drawer
            opened={!!(details || eventDetails)}
            onClose={() => {
              setSelectedUid(undefined);
              selectEvent(undefined);
            }}
            position="bottom"
            size="60%"
            withCloseButton={false}
          >
            {details || eventDetails}
          </Drawer>
        </>
      )}

      {drawingDialog}
      <StatusBar
        cursor={cursor}
        status={status}
        callsign={callsign}
        coordFormat={settings.coordFormat}
        itemCount={items.length}
        planName={activePlan?.name}
      />
    </div>
  );
};
