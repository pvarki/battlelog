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
  IconAlertTriangle,
  IconClipboardList,
  IconCurrentLocation,
  IconFolders,
  IconList,
  IconMessage,
  IconStack2,
} from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useIsMobile } from "../dashboard/mobile.ts";
import { ChatDrawer } from "./chat/ChatDrawer.tsx";
import { type ChatRecipient, newChatEvent } from "./chat/chat.ts";
import { useChatMessages } from "./chat/store.ts";
import { publish } from "./commands.ts";
import { ContactsDrawer } from "./contacts/ContactsDrawer.tsx";
import { recipientGroups } from "./contacts/SendTo.tsx";
import { type CotEvent, type Position, type TakItem, toChange } from "./cot.ts";
import { sendTestMarker } from "./dev-test-write.ts";
import { DrawToolbar } from "./drawing/DrawToolbar.tsx";
import { editGeometryEvent, editTarget } from "./drawing/edit-geometry.ts";
import { MeasurePanel } from "./drawing/MeasurePanel.tsx";
import { NewItemDialog } from "./drawing/NewItemDialog.tsx";
import {
  newMarkerEvent,
  newRangeBearingEvent,
  newRouteEvent,
  newShapeEvent,
  type ShapeStyle,
} from "./drawing/new-items.ts";
import { cotTypeOf, sidcOf } from "./drawing/symbol-catalogue.ts";
import { TacticalGraphicDialog } from "./drawing/TacticalGraphicDialog.tsx";
import { newTacticalGraphicEvent, type TacticalLook } from "./drawing/tactical-graphics.ts";
import { type Drawn, useDrawing } from "./drawing/useDrawing.ts";
import { useMeasure } from "./drawing/useMeasure.ts";
import { EmergencyBanner } from "./emergency/EmergencyBanner.tsx";
import { takSender, useCallsign } from "./identity.ts";
import { useInbox } from "./inbox/store.ts";
import { ItemDetails } from "./items/ItemDetails.tsx";
import { ItemsDrawer } from "./items/ItemsDrawer.tsx";
import { anchorOf, hasPosition, labelOf } from "./items.ts";
import { DEFAULT_BASEMAP, type MapSource, useMapSources } from "./map/basemaps.ts";
import { createCursor } from "./map/cursor.ts";
import { type Follow, followedItems, positionsOf, useFollow } from "./map/follow.ts";
import { LayersDrawer } from "./map/LayersDrawer.tsx";
import { MapCanvas } from "./map/MapCanvas.tsx";
import { PickChooser } from "./map/PickChooser.tsx";
import { MissionsDrawer } from "./missions/MissionsDrawer.tsx";
import { type MissionsState, useMissions, useMissionsSync } from "./missions/store.ts";
import { useMissionSubscriptions } from "./missions/writes.ts";
import { PlansDrawer } from "./plans/PlansDrawer.tsx";
import { addToPlan, type Plan, removeFromPlan, usePlans } from "./plans/plans.ts";
import { OwnPositionPanel } from "./position/OwnPositionPanel.tsx";
import { useOwnPosition } from "./position/useOwnPosition.ts";
import { SearchBox } from "./SearchBox.tsx";
import { CONNECTION_TEXT, StatusBar } from "./StatusBar.tsx";
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
import type { MapView, TakTool } from "./tools.ts";
import { trackFeatures } from "./tracks.ts";

const DRAWERS = {
  items: { label: "Items", Icon: IconList, key: "1" },
  missions: { label: "Missions", Icon: IconFolders, key: "2" },
  plans: { label: "Plans", Icon: IconClipboardList, key: "3" },
  layers: { label: "Layers", Icon: IconStack2, key: "4" },
  chat: { label: "Chat", Icon: IconMessage, key: "5" },
  contacts: { label: "Contacts", Icon: IconAddressBook, key: "6" },
} as const;

type DrawerId = keyof typeof DRAWERS;

const FOCUS_ZOOM = 14;

const KIND_NAME: Record<Drawn["kind"], string> = {
  marker: "Marker",
  line: "Line",
  polygon: "Area",
  rectangle: "Rectangle",
  circle: "Circle",
  route: "Route",
};

/** How a shape looks while it's being drawn: the new-item dialog's defaults. */
const PREVIEW_STYLE: ShapeStyle = {
  name: "",
  remarks: "",
  stroke: "#ffff00",
  strokeWeight: 3,
  strokeStyle: "solid",
  fillOpacity: 0.25,
  labelsOn: false,
};
const WALL_SYMBOL_SCALE = 1.5;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The live picture plus the items of missions shown on the map. A mission
 * item that is also live is the same uid; the live copy wins.
 */
const withMissionItems = (live: TakItem[], missions: MissionsState, shown: ReadonlySet<string>) => {
  const seen = new Set(live.map((i) => i.uid));
  const extra: TakItem[] = [];
  for (const [name, contents] of missions.contents) {
    if (!shown.has(name) || contents.kind !== "loaded") continue;
    for (const item of contents.items) {
      if (!seen.has(item.uid)) {
        seen.add(item.uid);
        extra.push(item);
      }
    }
  }
  return extra.length ? [...live, ...extra] : live;
};

type Draft = { item: TakItem; conflict: boolean; deleted: boolean };

/**
 * A plan's drafts as map items, named so they can't be mistaken for what TAK
 * has. A staged delete shows the item it removes, or what the delete names.
 */
// One item per stored draft, so re-rendering doesn't hand the map "new" items that changed nothing.
const draftItemCache = new WeakMap<CotEvent, TakItem>();
const draftItemOf = (event: CotEvent, item: TakItem) => {
  let cached = draftItemCache.get(event);
  if (!cached) {
    cached = { ...item, draft: true };
    draftItemCache.set(event, cached);
  }
  return cached;
};

const draftItems = (plan: Plan, live: TakItem[]): Draft[] =>
  plan.entries.flatMap(({ event, basedOn }): Draft[] => {
    const change = toChange(event);
    if (!change || change.kind === "offline") return [];
    const current = live.find((i) => i.uid === event.uid);
    const conflict = basedOn !== undefined && !!current && current.time > basedOn;
    if (change.kind === "upsert")
      return [{ item: draftItemOf(event, change.item), conflict, deleted: false }];
    const item: TakItem = current ?? {
      uid: event.uid,
      type: event.type,
      time: event.time,
      stale: event.stale,
      geometry: { type: "Point", coordinates: [0, 0] },
      event,
    };
    return [{ item: { ...item, draft: true }, conflict, deleted: true }];
  });

/** Live items with the active plan's drafts in place of (or beside) them; staged deletes hide theirs. */
const withDrafts = (items: TakItem[], drafts: Draft[]) => {
  if (drafts.length === 0) return items;
  const drafted = new Set(drafts.map((d) => d.item.uid));
  return [
    ...items.filter((i) => !drafted.has(i.uid)),
    ...drafts.flatMap((d) => (d.deleted ? [] : [d.item])),
  ];
};

const ConnectionBanner = ({ status }: { status: TakStatus }) => {
  if (status.connection !== "down") return null;
  return (
    <Alert color="danger" variant="filled" icon={<IconAlertTriangle size={18} />}>
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
    <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
  </Stack>
);

type Props = {
  /** What's switched on; all of it when absent (the Map page). */
  tools?: ReadonlySet<TakTool>;
  view?: MapView;
  /** Inside a dashboard widget: fills its box and leaves the page's keys alone. */
  embedded?: boolean;
  onMap?: (map: MapLibreMap | undefined) => void;
  /** "wall": a picture to read from across the room, with no chrome and nothing to click. */
  display?: "normal" | "wall";
  /** Overrides this browser's hidden overlay groups. */
  hiddenGroups?: ReadonlySet<string>;
  /** Shown besides the missions this browser shows. */
  missions?: readonly string[];
  /** Keeps these items in view as they move. */
  follow?: Follow;
};

/**
 * The TAK client: map, item list, layers and item details around one shared
 * TAK session. The Map page shows all of it; a dashboard widget shows the
 * tools it was configured with.
 */
export const TakWorkspace = ({
  tools,
  view,
  embedded,
  onMap,
  display,
  hiddenGroups,
  missions: extraMissions = [],
  follow,
}: Props) => {
  const wall = display === "wall";
  const has = (tool: TakTool) => !wall && (!tools || tools.has(tool));
  const drawers = (Object.keys(DRAWERS) as DrawerId[]).filter(has);
  useTakSession();
  const picture = useTakItems();
  const tracks = useTakTracks();
  const [trackedUids, setTrackedUids] = useState<ReadonlySet<string>>(new Set());
  const status = useTakStatus();
  const callsign = useCallsign();
  // Other tabs announce this same user; BattleLog never lists itself.
  const liveItems = picture.filter((i) => i.uid !== takSender(callsign).uid);
  const settings = useMapSettings();
  const mapSources = useMapSources(settings.customSources);
  const sourceById = (id: string | null) => mapSources.find((s) => s.id === id);
  const basemap = sourceById(settings.basemap) ?? (sourceById(DEFAULT_BASEMAP) as MapSource);
  const overlaySource = sourceById(settings.overlay);
  const hidden = hiddenGroups ?? settings.hidden;
  const shownMissions = new Set([
    ...settings.shownMissions,
    ...extraMissions,
    ...(follow?.mission ? [follow.mission] : []),
  ]);
  const isMobile = useIsMobile();
  const [chosenDrawer, setDrawer] = useState<DrawerId | null>(
    isMobile || !has("items") ? null : "items",
  );
  // A widget switched to fewer tools (or to wall display) closes what it no longer has.
  const drawer = chosenDrawer && drawers.includes(chosenDrawer) ? chosenDrawer : null;
  const [selectedUid, setSelectedUid] = useState<string>();
  const [chooser, setChooser] = useState<{ uids: string[]; at: { x: number; y: number } }>();
  const [openMission, setOpenMission] = useState<string>();
  const browsedMission = drawer === "missions" ? openMission : undefined;
  useMissionsSync([...shownMissions, ...(browsedMission ? [browsedMission] : [])]);
  useMissionSubscriptions([...shownMissions], callsign ? takSender(callsign).uid : undefined);
  const missions = useMissions();
  const plans = usePlans();
  // Without the plans tool there's no sign of a plan, so nothing may quietly go into one.
  const activePlan = has("plans") ? plans.plans.find((p) => p.id === plans.activeId) : undefined;
  const items = withDrafts(
    withMissionItems(liveItems, missions, shownMissions),
    activePlan ? draftItems(activePlan, liveItems) : [],
  );
  /** Where new items and changes go: the active plan, or straight to TAK. */
  const submit = (event: CotEvent) => {
    if (!activePlan) return void publish(event);
    const existing = liveItems.find((i) => i.uid === event.uid) ?? missionItem(event.uid);
    const planned = activePlan.entries.some((e) => e.event.uid === event.uid);
    // Deleting an item that exists only in the plan just drops its draft.
    if (toChange(event)?.kind === "delete" && !existing && planned)
      return removeFromPlan(activePlan, event.uid);
    addToPlan(activePlan, { event, basedOn: existing?.time });
  };
  const submitLabel = activePlan ? `Add to ${activePlan.name}` : "Save to TAK";
  const mapRef = useRef<MapLibreMap>(undefined);
  const [map, setMap] = useState<MapLibreMap>();
  const followMissionUids = new Set(
    missions.missions?.find((m) => m.name === follow?.mission)?.itemUids,
  );
  useFollow(map, follow ? positionsOf(followedItems(items, follow, followMissionUids)) : []);
  const drawing = useDrawing(map);
  const [cursor] = useState(createCursor);
  const measure = useMeasure(map, cursor);
  const searchRef = useRef<HTMLInputElement>(null);
  const missionItem = (uid: string) => {
    for (const contents of missions.contents.values()) {
      const found = contents.kind === "loaded" && contents.items.find((i) => i.uid === uid);
      if (found) return found;
    }
  };
  const selected = selectedUid
    ? (items.find((i) => i.uid === selectedUid) ?? missionItem(selectedUid))
    : undefined;
  const readOnlyReason = (item: TakItem) => {
    if (item.team) return "A TAK user's own position comes from their device";
    if (!callsign) return "No callsign: open BattleLog from the deploy app to change TAK items";
    if (!activePlan && status.connection !== "live") return "Not connected to TAK";
  };
  const contacts = recipientGroups(
    liveItems.filter((i) => i.team && i.callsign && i.callsign !== callsign),
  );
  const drawReason = !callsign
    ? "No callsign: open BattleLog from the deploy app to draw on TAK"
    : status.connection !== "live"
      ? "Not connected to TAK"
      : undefined;
  const sender = takSender(callsign);
  const chatMessages = useChatMessages();
  // Remembered across reloads now that chat is: a restored message read yesterday stays read.
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
  const [chatWith, setChatWith] = useState<ChatRecipient>();
  const sharing = has("contacts") && settings.sharePosition && !!callsign;
  useEffect(() => {
    const self = takSender(callsign);
    setTakPresence(callsign ? { ...self, team: settings.team, role: settings.role } : undefined);
  }, [callsign, settings.team, settings.role]);
  useEffect(() => (sharing ? holdPositionSharing() : undefined), [sharing]);
  const ownPosition = useOwnPosition(
    map,
    // Only where the switch is in reach: no sharing a user can't see or stop.
    has("contacts") && settings.sharePosition && callsign
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
      i.team && i.callsign && i.callsign !== callsign ? [{ uid: i.uid, callsign: i.callsign }] : [],
    )
    .sort((a, b) => a.callsign.localeCompare(b.callsign));
  const nameFor = (label: string) =>
    `${label} ${liveItems.filter((i) => i.callsign?.startsWith(`${label} `)).length + 1}`;
  const [tacticalLook, setTacticalLook] = useState<TacticalLook>();
  const pointsOf = (shape: Drawn | undefined) => (shape && "points" in shape ? shape.points : []);
  const tacticalPoints = pointsOf(drawing.drawn);
  const tacticalEvent = (points: Position[], uid?: string) =>
    drawing.graphic && tacticalLook
      ? newTacticalGraphicEvent(drawing.graphic, points, tacticalLook, sender, Date.now(), uid)
      : undefined;
  const [chosenStyle, setChosenStyle] = useState<ShapeStyle>();
  /** The shape being drawn as it will look once saved. */
  const previewOf = (sketch: Drawn | undefined, cursor: Position | undefined): TakItem[] => {
    const shape = drawing.drawn ?? sketch;
    // A symbol chosen before placing rides under the pointer until the click.
    const placing = drawing.tool === "marker" && !drawing.drawn ? drawing.symbol : undefined;
    const event = placing
      ? cursor &&
        newMarkerEvent(
          {
            position: cursor,
            name: "",
            remarks: "",
            kind: "symbol",
            color: "",
            symbol: { sidc: sidcOf(placing), type: cotTypeOf(placing) },
          },
          sender,
          Date.now(),
          "preview",
        )
      : drawing.graphic
        ? pointsOf(shape).length > 1
          ? tacticalEvent(pointsOf(shape), "preview")
          : undefined
        : shape && shape.kind !== "marker" && shape.kind !== "route"
          ? newShapeEvent(
              shape,
              (drawing.drawn && chosenStyle) || {
                ...PREVIEW_STYLE,
                name: nameFor(KIND_NAME[shape.kind]),
              },
              sender,
              Date.now(),
              "preview",
            )
          : undefined;
    const change = event && toChange(event);
    if (change?.kind !== "upsert") return [];
    return [placing ? { ...change.item, hideLabel: true } : change.item];
  };
  const newItemDialog = drawing.drawn && (
    <NewItemDialog
      drawn={drawing.drawn}
      defaultName={nameFor(KIND_NAME[drawing.drawn.kind])}
      onCancel={drawing.clear}
      onStyle={setChosenStyle}
      saveLabel={submitLabel}
      initialSymbol={drawing.symbol}
      onSaveShape={(style) => {
        if (drawing.drawn && drawing.drawn.kind !== "marker" && drawing.drawn.kind !== "route")
          submit(newShapeEvent(drawing.drawn, style, sender));
        drawing.clear();
      }}
      onSaveMarker={(marker) => {
        if (drawing.drawn?.kind === "marker")
          submit(newMarkerEvent({ ...marker, position: drawing.drawn.position }, sender));
        drawing.clear();
      }}
      onSaveRoute={(route) => {
        if (drawing.drawn?.kind === "route")
          submit(newRouteEvent({ ...route, points: drawing.drawn.points }, sender));
        drawing.clear();
      }}
    />
  );
  const tacticalDialog = drawing.drawn && drawing.graphic && tacticalLook && (
    <TacticalGraphicDialog
      graphic={drawing.graphic}
      pointCount={tacticalPoints.length}
      value={tacticalLook}
      onChange={setTacticalLook}
      onCancel={drawing.clear}
      saveLabel={submitLabel}
      onSave={() => {
        const event = tacticalEvent(tacticalPoints);
        if (event) submit(event);
        drawing.clear();
      }}
    />
  );
  const callsignOf = (uid: string) => liveItems.find((i) => i.uid === uid)?.callsign;
  const missionsOf = (uid: string) =>
    (missions.missions ?? []).filter((m) => m.itemUids.includes(uid)).map((m) => m.name);

  const flyTo = (position: Position) => {
    const map = mapRef.current;
    map?.flyTo({ center: position, zoom: Math.max(map.getZoom(), FOCUS_ZOOM) });
  };

  const pick = (item: TakItem) => {
    setSelectedUid(item.uid);
    if (hasPosition(item)) flyTo(anchorOf(item));
    if (isMobile) setDrawer(null);
  };

  const toggleTrack = (uid: string) => {
    const next = new Set(trackedUids);
    if (next.delete(uid)) return setTrackedUids(next);
    setTrackedUids(next.add(uid));
    void loadTrack(uid);
  };

  const toggleDrawer = (id: DrawerId) => {
    setChatWith(undefined);
    setDrawer((open) => (open === id ? null : id));
  };

  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (chooser) setChooser(undefined);
        else if (measure.active) measure.stop();
        else if (drawing.editing) drawing.clear();
        else if (drawing.tool && !drawing.drawn) drawing.clear();
        else if (selectedUid) setSelectedUid(undefined);
        else setDrawer(null);
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
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
        sendReason={drawReason}
        onSend={(text, to) => sendCot(newChatEvent(text, to, sender))}
        initialRoom={chatWith}
      />
    ) : id === "contacts" ? (
      <ContactsDrawer
        contacts={liveItems.filter((i) => i.team && i.uid !== sender.uid)}
        map={map}
        ownPosition={ownPosition.fix?.position}
        onCenter={pick}
        onChat={(contact) => {
          setChatWith({ uid: contact.uid, callsign: contact.callsign ?? contact.uid });
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
        clientUid={callsign ? sender.uid : undefined}
      />
    ) : id === "items" ? (
      <ItemsDrawer
        items={items}
        selectedUid={selectedUid}
        onPick={pick}
        hidden={settings.hidden}
        onToggleGroup={settings.toggleGroup}
      />
    ) : (
      <LayersDrawer
        settings={settings}
        sources={mapSources}
        clientUid={callsign ? sender.uid : undefined}
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
      </LayersDrawer>
    );

  const details = !wall && selected && (
    <ItemDetails
      key={selected.uid}
      item={selected}
      coordFormat={settings.coordFormat}
      missions={missionsOf(selected.uid)}
      allMissions={missions.missions ?? []}
      clientUid={callsign ? sender.uid : undefined}
      readOnlyReason={readOnlyReason(selected)}
      callsign={callsign}
      contacts={contacts}
      sendReason={drawReason}
      onSubmit={submit}
      submitLabel={submitLabel}
      onEditShape={
        has("draw") && editTarget(selected)
          ? () => {
              // The details sheet would cover the map being edited.
              if (drawing.edit(selected) && isMobile) setSelectedUid(undefined);
            }
          : undefined
      }
      planActive={!!activePlan}
      tracking={settings.showAllTracks || trackedUids.has(selected.uid)}
      onToggleTrack={settings.showAllTracks ? undefined : () => toggleTrack(selected.uid)}
      onCenter={() => flyTo(anchorOf(selected))}
      onClose={() => setSelectedUid(undefined)}
    />
  );

  return (
    <div
      className="tak-workspace"
      data-mobile={isMobile || undefined}
      data-embedded={embedded || undefined}
      data-wall={wall || undefined}
      data-no-rail={drawers.length === 0 || undefined}
    >
      <nav className="tak-rail" aria-label="Map tools" hidden={drawers.length === 0}>
        {drawers.map((id) => {
          const { label, Icon, key } = DRAWERS[id];
          return (
            <UnstyledButton
              key={id}
              className="tak-rail-button"
              aria-pressed={drawer === id}
              onClick={() => toggleDrawer(id)}
              title={embedded ? label : `${label} (${key})`}
            >
              <Indicator label={badges[id]} size={16} color="red" disabled={!badges[id]}>
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
            tracks,
            hidden,
          )}
          hidden={hidden}
          basemap={basemap}
          overlay={overlaySource && { source: overlaySource, opacity: settings.overlayOpacity }}
          dim={settings.dim}
          mgrsGrid={settings.mgrsGrid}
          selectedUid={selectedUid}
          onPick={(uids, at) => {
            if (drawing.tool || drawing.editing || measure.active) return;
            setChooser(uids.length > 1 ? { uids, at } : undefined);
            setSelectedUid(uids.length > 1 ? selectedUid : uids[0]);
          }}
          onReady={(ready) => {
            mapRef.current = ready;
            setMap(ready);
            onMap?.(ready);
          }}
          view={view}
          passive={wall}
          symbolScale={wall ? WALL_SYMBOL_SCALE : 1}
        />
        {has("search") && (
          <div className="tak-search-slot">
            <SearchBox
              ref={searchRef}
              items={items}
              coordFormat={settings.coordFormat}
              onPickItem={pick}
              onGoTo={flyTo}
            />
          </div>
        )}
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
        {has("draw") && (
          <DrawToolbar
            tool={drawing.tool}
            onChoose={(tool) => {
              measure.stop();
              drawing.choose(tool);
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
            disabledReason={activePlan ? undefined : drawReason}
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
            measuring={measure.active}
            onToggleMeasure={() => {
              if (measure.active) return measure.stop();
              drawing.choose(undefined);
              measure.start();
            }}
          >
            <MeasurePanel
              points={measure.points}
              cursor={cursor}
              onClear={measure.clear}
              onSave={() => {
                const [from, to] = measure.points;
                if (from && to) submit(newRangeBearingEvent([from, to], nameFor("R&B")));
                measure.stop();
              }}
              saveDisabledReason={activePlan ? undefined : drawReason}
            />
          </DrawToolbar>
        )}
        <div className="tak-banners">
          <EmergencyBanner items={liveItems} map={map} onCenter={pick} />
          {!wall && <ConnectionBanner status={status} />}
        </div>
        {wall && (
          <span
            className="tak-connection-dot"
            data-connection={status.connection}
            role="status"
            aria-label={CONNECTION_TEXT[status.connection]}
            title={CONNECTION_TEXT[status.connection]}
          />
        )}
      </div>

      {!isMobile && details && (
        <aside className="tak-details" aria-label="Item details">
          {details}
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
            opened={!!details}
            onClose={() => setSelectedUid(undefined)}
            position="bottom"
            size="60%"
            withCloseButton={false}
          >
            {details}
          </Drawer>
        </>
      )}

      {drawing.graphic ? tacticalDialog : newItemDialog}
      {!wall && (
        <StatusBar
          cursor={cursor}
          status={status}
          callsign={callsign}
          coordFormat={settings.coordFormat}
          itemCount={items.length}
        />
      )}
    </div>
  );
};
