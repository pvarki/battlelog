import "./tak.css";
import { Button, Drawer, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPencil } from "@tabler/icons-react";
import { type Map as MapLibreMap, Marker } from "maplibre-gl";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useStoredSetting } from "../stored-setting.ts";
import { ACCENT } from "../theme.ts";
import { useIsMobile } from "../viewport.ts";
import { ChatDrawer } from "./chat/ChatDrawer.tsx";
import { type ChatRoom, directRoom, isUnread, newChatEvent, READ_AT_KEY } from "./chat/chat.ts";
import { useChatMessages } from "./chat/store.ts";
import { NO_CALLSIGN } from "./checklists/ChecklistDetail.tsx";
import { ChecklistsDrawer } from "./checklists/ChecklistsDrawer.tsx";
import { CommandBar, openCommandBar } from "./commands/CommandBar.tsx";
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
import { SelectionPanel } from "./drawing/SelectionPanel.tsx";
import { type Drawn, type Tool, useDrawing } from "./drawing/useDrawing.ts";
import { useDrawingWorkflow } from "./drawing/useDrawingWorkflow.tsx";
import { useMeasure } from "./drawing/useMeasure.ts";
import { EmergencyBanner } from "./emergency/EmergencyBanner.tsx";
import { EventDetails } from "./event-layers/EventDetails.tsx";
import { EventLayerFeeds } from "./event-layers/EventLayerFeeds.tsx";
import { useShownEventLayers } from "./event-layers/useShownEventLayers.ts";
import { GeofenceBanner } from "./geofence/GeofenceBanner.tsx";
import { breachEvent } from "./geofence/geofence.ts";
import { useGeofenceAlerts } from "./geofence/useGeofenceAlerts.ts";
import { takSender, useCallsign } from "./identity.ts";
import { useInbox } from "./inbox/store.ts";
import { ItemDetails } from "./items/ItemDetails.tsx";
import { ItemsDrawer } from "./items/ItemsDrawer.tsx";
import { labelOf } from "./items.ts";
import { useKeymap } from "./keys/useKeymap.ts";
import { LayersDrawer } from "./layers/LayersDrawer.tsx";
import { ConnectionBanner, MapButtons } from "./MapButtons.tsx";
import { DEFAULT_BASEMAP, type MapSource, useMapSources } from "./map/basemaps.ts";
import { centreOnItem, flyToPosition } from "./map/camera.ts";
import { createCursor } from "./map/cursor.ts";
import { MapCanvas } from "./map/MapCanvas.tsx";
import { PickChooser } from "./map/PickChooser.tsx";
import { MissionsDrawer } from "./missions/MissionsDrawer.tsx";
import { feedItemUids, useMissions, useMissionsSync } from "./missions/store.ts";
import { useMissionSubscriptions } from "./missions/writes.ts";
import { DETAILS_WIDTH, DRAWER_WIDTH, Panel, ResizeHandle } from "./panel.tsx";
import { draftItems, workspacePicture } from "./picture.ts";
import { PlansDrawer } from "./plans/PlansDrawer.tsx";
import { usePlans } from "./plans/plans.ts";
import { OwnPositionPanel } from "./position/OwnPositionPanel.tsx";
import { useOwnPosition } from "./position/useOwnPosition.ts";
import { ReplayBanner, ReplayBar } from "./replay/ReplayBar.tsx";
import { DEFAULT_REPLAY_WINDOW_MS, useReplay } from "./replay/useReplay.ts";
import { SettingsDrawer, type SettingsPage } from "./SettingsDrawer.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { StatusBar } from "./StatusBar.tsx";
import {
  holdPositionSharing,
  loadTrack,
  sendCot,
  setTakPresence,
  useTakItems,
  useTakSession,
  useTakStatus,
  useTakTracks,
} from "./session.ts";
import { useMapSettings } from "./settings.ts";
import type { MapView } from "./tools.ts";
import { trackFeatures } from "./tracks.ts";
import { describeStep } from "./undo.ts";
import { useMapTools } from "./use-map-tools.ts";
import { type Selection, useCentreWhenReady, useSelection } from "./use-selection.ts";
import { useTakWrites } from "./use-tak-writes.ts";
import { useWorkspaceKeys } from "./use-workspace-keys.ts";
import {
  DRAWER_IDS,
  DRAWERS,
  type DrawerId,
  focusRailButton,
  WorkspaceRail,
} from "./WorkspaceRail.tsx";
import { workspaceCommands } from "./workspace-commands.tsx";

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
  const [drawerWidth, setDrawerWidth] = useStoredSetting({
    key: "battlelog.tak.drawerWidth",
    defaultValue: DRAWER_WIDTH,
  });
  const [detailsWidth, setDetailsWidth] = useStoredSetting({
    key: "battlelog.tak.detailsWidth",
    defaultValue: DETAILS_WIDTH,
  });
  const {
    selectedUid,
    selectedEventId,
    selectUid: setSelectedUid,
    selectEvent,
    pendingCentre,
  } = useSelection({ selection, onSelect });
  const [chooser, setChooser] = useState<{ uids: string[]; at: { x: number; y: number } }>();
  const [openMission, setOpenMission] = useState<string>();
  const [openPlan, setOpenPlan] = useState<string>();
  const [settingsPage, setSettingsPage] = useState<SettingsPage>();
  const browsedMission = drawer === "missions" ? openMission : undefined;
  useMissionsSync([...shownMissions, ...(browsedMission ? [browsedMission] : [])], clientUid);
  useMissionSubscriptions([...shownMissions], clientUid);
  const missions = useMissions();
  const plans = usePlans();
  const activePlan = plans.plans.find((p) => p.id === plans.activeId);
  const replay = useReplay();
  const replaying = replay.windowMs !== undefined;
  const replayFrame = replaying ? replay.frame : undefined;
  // Until the active plan is read, a change would go to TAK instead of into the plan.
  const planReason =
    plans.activeId && !activePlan
      ? plans.status === "failed"
        ? "The active plan couldn't be read from this browser: reload the page"
        : "Opening the active plan…"
      : undefined;
  const blockedReason = replaying ? "Replaying history: go back to live to change TAK" : planReason;
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
      missionItem,
      blockedReason,
      callsign,
      connection: status.connection,
    });
  const submitLabel = activePlan ? `Add to ${activePlan.name}` : "Save to TAK";
  const mapRef = useRef<MapLibreMap>(undefined);
  const [map, setMap] = useState<MapLibreMap>();
  const drawing = useDrawing(map);
  const [cursor] = useState(createCursor);
  const measure = useMeasure(map, cursor);
  const selected = selectedUid ? currentItem(selectedUid) : undefined;
  const { keymap, shortcutOf } = useKeymap();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const contacts = recipientGroups(
    liveItems.filter((i) => i.team && i.callsign && i.callsign !== callsign),
  );
  const sendReason = !callsign
    ? "No callsign: open BattleLog from the deploy app to draw on TAK"
    : status.connection !== "live"
      ? "Not connected to TAK"
      : undefined;
  const drawReason = blockedReason ?? sendReason;
  const fenceAlerts = useGeofenceAlerts(liveItems, callsign);
  const sender = takSender(callsign);
  // Mission, plan and group controls write to TAK directly: none of them while replaying.
  const writerUid = callsign && !replaying ? sender.uid : undefined;
  const chatMessages = useChatMessages();
  const [chatReadAt] = useStoredSetting<Record<string, number>>({
    key: READ_AT_KEY,
    defaultValue: {},
  });
  const unreadChats =
    drawer === "chat" ? 0 : chatMessages.filter((m) => isUnread(m, chatReadAt, sender.uid)).length;
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
  const tools = useMapTools({
    drawing,
    measure,
    nameFor,
    setRingsLook,
    selectedUid,
    setSelectedUid,
  });
  const { grouped, toggleGrouped, addToGroup, clearGroup, setDrawOpen } = tools;
  const groupItems = items.filter((i) => grouped.has(i.uid));
  const movableItems = groupItems.filter((i) => canChange(i) && editTarget(i));
  const deletableItems = groupItems.filter(canChange);
  const moveGroupTo = (target: Position) => {
    const by = offsetBetween(centreOfItems(movableItems), target);
    submitAll(movableItems.map((item) => movedEvent(item, by)));
    tools.stopMode();
  };
  const movedPreview = (target: Position) => {
    const by = offsetBetween(centreOfItems(movableItems), target);
    return movableItems.flatMap((item) => {
      const change = toChange(movedEvent(item, by));
      return change?.kind === "upsert" ? [change.item] : [];
    });
  };
  const previewOf = (sketch: Drawn | undefined, cursor: Position | undefined): TakItem[] =>
    tools.movingGroup ? (cursor ? movedPreview(cursor) : []) : drawingPreview(sketch, cursor);
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

  const toggleReplay = () => {
    if (replaying) return replay.stop();
    drawing.clear();
    measure.stop();
    replay.setWindowMs(DEFAULT_REPLAY_WINDOW_MS);
  };
  const openChatWith = (item: TakItem) => {
    setChatWith(directRoom(item.uid, item.callsign ?? item.uid));
    setDrawer("chat");
  };
  const editShape = (item: TakItem) => {
    if (tools.laser) tools.stopMode();
    // The details sheet would cover the map being edited.
    if (drawing.edit(item) && isMobile) setSelectedUid(undefined);
  };

  /** Closes the drawer, handing focus back to its rail button rather than losing it to the page. */
  const closeDrawer = () => {
    if (drawer) focusRailButton(drawer);
    setDrawer(null);
  };
  const toggleDrawer = (id: DrawerId) => {
    setChatWith(undefined);
    setDrawer((open) => (open === id ? null : id));
  };

  const startTool = (tool: Tool) => {
    const reason = activePlan ? blockedReason : drawReason;
    if (reason) return notifications.show({ color: "warning", message: reason });
    setDrawOpen(true);
    tools.chooseTool(drawing.tool === tool ? undefined : tool);
  };
  const keyActions: Record<string, () => void> = {
    commandBar: openCommandBar,
    shortcuts: () => setShowShortcuts((open) => !open),
    undo: () => {
      setDrawOpen(true);
      undo();
    },
    centre: () => {
      if (selected) centreOn(selected);
      else if (selectedEvent?.locationPoint)
        flyTo([selectedEvent.locationPoint.lng, selectedEvent.locationPoint.lat]);
    },
    laser: tools.toggleLaser,
    drawingTools: tools.toggleDrawing,
    "draw.marker": () => startTool("marker"),
    "draw.route": () => startTool("route"),
    "draw.polygon": () => startTool("polygon"),
    measure: () => {
      setDrawOpen(true);
      tools.toggleMeasure();
    },
    lasso: () => {
      setDrawOpen(true);
      tools.toggleLasso();
    },
    mgrsGrid: () => settings.setMgrsGrid(!settings.mgrsGrid),
    tracks: () => settings.setShowAllTracks(!settings.showAllTracks),
    dim: () => settings.setDim(!settings.dim),
    replay: toggleReplay,
    locate: ownPosition.toggleLocate,
    ...Object.fromEntries(DRAWER_IDS.map((id) => [`drawer.${id}`, () => toggleDrawer(id)])),
  };

  useWorkspaceKeys({
    keymap,
    actions: keyActions,
    onEscape: () => {
      if (chooser) setChooser(undefined);
      else if (goToPin.current) clearGoToPin();
      else if (tools.laser) tools.stopMode();
      else if (measure.active) measure.stop();
      else if (drawing.editing) drawing.clear();
      else if (drawing.tool && !drawing.drawn) drawing.clear();
      else if (tools.mode) tools.stopMode();
      else if (grouped.size) clearGroup();
      else if (selectedUid) setSelectedUid(undefined);
      else if (selectedEventId) selectEvent(undefined);
      else closeDrawer();
    },
  });

  const commandBar = workspaceCommands({
    drawers: DRAWER_IDS.map((id) => ({ id, ...DRAWERS[id] })),
    shortcutOf,
    openDrawer: (id) => {
      setChatWith(undefined);
      setDrawer(id as DrawerId);
    },
    chooseTool: (tool) => {
      setDrawOpen(true);
      tools.chooseTool(tool);
    },
    drawReason: activePlan ? blockedReason : drawReason,
    measuring: measure.active,
    toggleMeasure: tools.toggleMeasure,
    lassoing: tools.lassoing,
    toggleLasso: tools.toggleLasso,
    laser: tools.laser,
    toggleLaser: tools.toggleLaser,
    toggleDrawing: tools.toggleDrawing,
    undo: () => {
      setDrawOpen(true);
      undo();
    },
    undoReason,
    replaying,
    toggleReplay,
    toggleLocate: ownPosition.toggleLocate,
    showShortcuts: () => setShowShortcuts(true),
    settings,
    sources: mapSources,
    basemapId: basemap.id,
    eventLayers,
    missions: missions.missions ?? [],
    openFeed: (name) => {
      setOpenMission(name);
      setDrawer("missions");
    },
    plans: plans.plans,
    activePlanId: plans.activeId ?? undefined,
    openPlan: (id) => {
      setOpenPlan(id);
      setDrawer("plans");
    },
    items,
    currentItem,
    coordFormat: settings.coordFormat,
    ownPosition: ownPosition.fix?.position,
    selfCallsign: callsign ?? undefined,
    pick,
    centreOn,
    goTo,
    chatWith: openChatWith,
    tracking: (uid) => settings.showAllTracks || trackedUids.has(uid),
    toggleTrack: settings.showAllTracks ? undefined : toggleTrack,
    editShape: (item) =>
      editTarget(item)
        ? {
            run: () => {
              setSelectedUid(item.uid);
              editShape(item);
            },
            reason: readOnlyReason(item),
          }
        : undefined,
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
        onChat={openChatWith}
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
        open={openPlan}
        onOpen={setOpenPlan}
      />
    ) : id === "checklists" ? (
      <ChecklistsDrawer
        writer={writerUid ? sender : undefined}
        readOnlyReason={blockedReason ?? NO_CALLSIGN}
      />
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
        onToggleGrouped={tools.busy ? undefined : (item) => toggleGrouped(item.uid)}
        hidden={settings.hidden}
        onToggleGroup={settings.toggleGroup}
        map={map}
        ownPosition={ownPosition.fix?.position}
        feeds={feedItemUids(missions)}
      />
    ) : id === "layers" ? (
      <LayersDrawer
        settings={settings}
        sources={mapSources}
        map={map}
        basemap={basemap}
        eventLayers={eventLayers}
        truncated={truncatedLayers}
      />
    ) : (
      <SettingsDrawer
        settings={settings}
        clientUid={writerUid}
        page={settingsPage}
        onPage={setSettingsPage}
      >
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
      onEditShape={editTarget(selected) ? () => editShape(selected) : undefined}
      editShapeLoading={!drawing.ready}
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
      <WorkspaceRail
        open={drawer}
        onToggle={toggleDrawer}
        badges={badges}
        shortcutOf={shortcutOf}
      />

      {!isMobile && drawer && (
        <aside
          className="tak-drawer"
          aria-label={DRAWERS[drawer].label}
          style={{ "--tak-panel-width": `${drawerWidth}px` } as CSSProperties}
        >
          <Panel title={DRAWERS[drawer].label} onClose={closeDrawer}>
            {drawerContent(drawer)}
          </Panel>
          <ResizeHandle
            width={drawerWidth}
            onWidth={setDrawerWidth}
            defaultWidth={DRAWER_WIDTH}
            label="Drawer width"
          />
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
            if (tools.movingGroup) return moveGroupTo(position);
            if (tools.busy) return;
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
          onBoxSelect={!tools.busy && !tools.movingGroup ? addToGroup : undefined}
          onLasso={tools.lassoing && !tools.busy ? addToGroup : undefined}
          laser={tools.laser}
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
        <MapButtons
          map={map}
          locating={ownPosition.locating}
          onLocate={ownPosition.toggleLocate}
          replaying={replaying}
          onReplay={toggleReplay}
          coordFormat={settings.coordFormat}
        />
        <ShortcutsDialog
          opened={showShortcuts}
          onClose={() => setShowShortcuts(false)}
          onEdit={() => {
            setShowShortcuts(false);
            setSettingsPage("shortcuts");
            setDrawer("settings");
          }}
        />
        <div className="tak-overlay">
          {/* Search and draw together: the tools open right under the button that opens them. */}
          <div className="tak-command-row">
            <div className="tak-search-slot">
              <CommandBar {...commandBar} shortcut={shortcutOf("commandBar")} />
            </div>
            <UnstyledButton
              className="tak-draw-toggle"
              aria-pressed={tools.toolbarShown}
              aria-label="Drawing tools"
              onClick={tools.toggleDrawing}
              title="Drawing tools (D)"
            >
              <IconPencil size={18} stroke={1.5} />
              {!isMobile && <span>Draw</span>}
            </UnstyledButton>
          </div>
          <div className="tak-banners">
            <EmergencyBanner items={liveItems} map={map} onCenter={pick} />
            <GeofenceBanner
              alerts={fenceAlerts.alerts}
              unwatched={fenceAlerts.unwatched}
              items={liveItems}
              isDismissed={fenceAlerts.isDismissed}
              onShow={(uid) => {
                const item = currentItem(uid);
                if (item) pick(item);
              }}
              onDismiss={fenceAlerts.dismiss}
              onDismissReceived={fenceAlerts.dismissReceived}
              onSend={(alert) => {
                // Not shown locally: it would come back as a received alert about our own crossing.
                const sent = sendCot(breachEvent(alert, sender), { local: false });
                notifications.show(
                  sent
                    ? { color: "success", message: "Breach alert sent to TAK" }
                    : { color: "danger", message: "Not connected to TAK" },
                );
                if (sent) fenceAlerts.dismiss(alert.id);
              }}
              sendReason={blockedReason ?? sendReason}
            />
            {replaying && <ReplayBanner replay={replay} />}
            <ConnectionBanner status={status} />
          </div>
          {tools.toolbarShown && (
            <DrawToolbar
              tool={drawing.tool}
              onChoose={tools.chooseTool}
              graphic={drawing.graphic}
              symbol={drawing.symbol}
              onChooseSymbol={(symbol) => {
                tools.beforeDrawing();
                drawing.choose("marker", undefined, symbol);
              }}
              onChooseGraphic={(graphic) => {
                tools.beforeDrawing();
                drawing.choose(graphic && (graphic.shape === "line" ? "line" : "polygon"), graphic);
                if (graphic)
                  setTacticalLook({
                    name: nameFor(graphic.name),
                    affiliation: "friendly",
                    remarks: "",
                  });
              }}
              disabledReason={activePlan ? blockedReason : drawReason}
              planName={activePlan?.name}
              editing={
                drawing.editing && {
                  name: labelOf(drawing.editing),
                  saveLabel: submitLabel,
                  onCancel: drawing.clear,
                  onSave: () => {
                    const uid = drawing.editing?.uid;
                    const edited = drawing.edited();
                    drawing.clear();
                    if (!uid || !edited) return;
                    // From the item as it is now: what others changed while this was reshaped stays.
                    const current = items.find((i) => i.uid === uid);
                    if (current) submit(editGeometryEvent(current, edited));
                    else
                      notifications.show({
                        color: "warning",
                        message: "The item was deleted while you reshaped it; nothing was sent.",
                      });
                  },
                }
              }
              selection={
                groupItems.length > 0 ? (
                  <SelectionPanel
                    count={groupItems.length}
                    movable={movableItems.length}
                    deletable={deletableItems.length}
                    moving={tools.movingGroup}
                    onMove={tools.startMove}
                    onCancelMove={tools.stopMode}
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
              lassoing={tools.lassoing}
              onToggleLasso={tools.toggleLasso}
              laser={tools.laser}
              onToggleLaser={tools.toggleLaser}
              onToggleMeasure={tools.toggleMeasure}
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
                saveDisabledReason={activePlan ? blockedReason : drawReason}
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
        <aside
          className="tak-details"
          aria-label="Item details"
          style={{ "--tak-panel-width": `${detailsWidth}px` } as CSSProperties}
        >
          <div className="tak-details-body">{details || eventDetails}</div>
          <ResizeHandle
            width={detailsWidth}
            onWidth={setDetailsWidth}
            defaultWidth={DETAILS_WIDTH}
            label="Details width"
            edge="left"
          />
        </aside>
      )}

      {isMobile && (
        <>
          <Drawer
            opened={drawer !== null}
            onClose={() => setDrawer(null)}
            position="bottom"
            size="70%"
            withCloseButton={false}
            styles={{ body: { height: "100%" } }}
          >
            {drawer && (
              <Panel title={DRAWERS[drawer].label} onClose={() => setDrawer(null)}>
                {drawerContent(drawer)}
              </Panel>
            )}
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
