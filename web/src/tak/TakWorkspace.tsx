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
  IconClipboardList,
  IconCurrentLocation,
  IconFolders,
  IconHistory,
  IconList,
  IconMessage,
  IconPlugConnectedX,
  IconStack2,
} from "@tabler/icons-react";
import { type Map as MapLibreMap, Marker } from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type EventResponse } from "../api.ts";
import { useIsMobile } from "../dashboard/mobile.ts";
import { ACCENT } from "../theme.ts";
import { ChatDrawer } from "./chat/ChatDrawer.tsx";
import { type ChatRoom, directRoom, newChatEvent } from "./chat/chat.ts";
import { useChatMessages } from "./chat/store.ts";
import { deleteEvent, publish } from "./commands.ts";
import { ContactsDrawer } from "./contacts/ContactsDrawer.tsx";
import { recipientGroups } from "./contacts/SendTo.tsx";
import { type CotEvent, type Position, type TakItem, toChange } from "./cot.ts";
import { sendTestMarker } from "./dev-test-write.ts";
import { DrawToolbar, UndoButton } from "./drawing/DrawToolbar.tsx";
import { editGeometryEvent, editTarget } from "./drawing/edit-geometry.ts";
import { MeasurePanel } from "./drawing/MeasurePanel.tsx";
import { centreOfItems, movedEvent, offsetBetween } from "./drawing/move-items.ts";
import { NewItemDialog } from "./drawing/NewItemDialog.tsx";
import {
  newBullseyeEvent,
  newMarkerEvent,
  newRangeBearingEvent,
  newRangeRingsEvent,
  newRouteEvent,
  newShapeEvent,
  type ShapeStyle,
} from "./drawing/new-items.ts";
import { defaultRingsLook, RingsDialog, type RingsLook } from "./drawing/RingsDialog.tsx";
import { SelectionPanel } from "./drawing/SelectionPanel.tsx";
import { cotTypeOf, sidcOf } from "./drawing/symbol-catalogue.ts";
import { TacticalGraphicDialog } from "./drawing/TacticalGraphicDialog.tsx";
import { newTacticalGraphicEvent, type TacticalLook } from "./drawing/tactical-graphics.ts";
import { type Drawn, TOOLS, useDrawing } from "./drawing/useDrawing.ts";
import { useMeasure } from "./drawing/useMeasure.ts";
import { EmergencyBanner } from "./emergency/EmergencyBanner.tsx";
import { EventDetails } from "./event-layers/EventDetails.tsx";
import { EventLayerFeeds, type LayerEvents } from "./event-layers/EventLayerFeeds.tsx";
import { EventLayersSection } from "./event-layers/EventLayersSection.tsx";
import { featureCollection, layerFeatures } from "./event-layers/layers.ts";
import { useEventLayers } from "./event-layers/store.ts";
import { takSender, useCallsign } from "./identity.ts";
import { useInbox } from "./inbox/store.ts";
import { ItemDetails } from "./items/ItemDetails.tsx";
import { ItemsDrawer } from "./items/ItemsDrawer.tsx";
import { anchorOf, extentOf, hasPosition, labelOf } from "./items.ts";
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
import { addToPlan, draftOf, type Plan, removeFromPlan, usePlans } from "./plans/plans.ts";
import { OwnPositionPanel } from "./position/OwnPositionPanel.tsx";
import { useOwnPosition } from "./position/useOwnPosition.ts";
import { ReplayBanner, ReplayBar } from "./replay/ReplayBar.tsx";
import { DEFAULT_REPLAY_WINDOW_MS, useReplay } from "./replay/useReplay.ts";
import { SearchBox } from "./SearchBox.tsx";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";
import { CONNECTION_TEXT, StatusBar } from "./StatusBar.tsx";
import {
  holdPositionSharing,
  loadTrack,
  sendCot,
  setTakPresence,
  type TakStatus,
  takStore,
  useTakItems,
  useTakSession,
  useTakStatus,
  useTakTracks,
} from "./session.ts";
import { useMapSettings } from "./settings.ts";
import type { MapView, TakTool } from "./tools.ts";
import { trackFeatures } from "./tracks.ts";
import { describeStep, type UndoStep, undoEvents, withStep } from "./undo.ts";
import { useNow } from "./use-now.ts";

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
const FIT_PADDING_PX = 60;
// Close enough for a building-sized shape to fill the view; MML maps go to 19.
const FIT_MAX_ZOOM = 18;

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
  /** The BattleLog layers shown, fixed; absent = this browser's choice. */
  eventLayers?: readonly string[];
  /**
   * What's selected, held outside (a dashboard keeps it in the URL so other
   * widgets follow): one TAK item or one BattleLog event, never both.
   */
  selection?: Selection;
  onSelect?: (selection: Selection) => void;
  /** Whether a selection made outside the map brings it into view. */
  centreOnSelection?: boolean;
};

export type Selection = { tak?: string; event?: string };

const selectionKey = (s: Selection) => `${s.tak ?? ""}|${s.event ?? ""}`;

const LAYER_CLOCK_MS = 60_000;

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
  eventLayers: fixedEventLayers,
  selection,
  onSelect,
  centreOnSelection = true,
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
  const [selectedUid, setSelectedUidState] = useState<string>();
  const [selectedEventId, setSelectedEventId] = useState<string>();
  /** Selecting a TAK item lets go of any selected event, and back. */
  const setSelectedUid = (uid: string | undefined) => {
    setSelectedUidState(uid);
    if (uid) setSelectedEventId(undefined);
  };
  const selectEvent = (eventId: string | undefined) => {
    setSelectedEventId(eventId);
    if (eventId) setSelectedUidState(undefined);
  };
  const [chooser, setChooser] = useState<{ uids: string[]; at: { x: number; y: number } }>();
  const [openMission, setOpenMission] = useState<string>();
  const browsedMission = drawer === "missions" ? openMission : undefined;
  const clientUid = callsign ? takSender(callsign).uid : undefined;
  useMissionsSync([...shownMissions, ...(browsedMission ? [browsedMission] : [])], clientUid);
  useMissionSubscriptions([...shownMissions], clientUid);
  const missions = useMissions();
  const plans = usePlans();
  // Without the plans tool there's no sign of a plan, so nothing may quietly go into one.
  const activePlan = has("plans") ? plans.plans.find((p) => p.id === plans.activeId) : undefined;
  const replay = useReplay();
  const replaying = replay.windowMs !== undefined;
  const replayFrame = replaying ? replay.frame : undefined;
  const replayReason = replaying ? "Replaying history: go back to live to change TAK" : undefined;
  const eventLayers = useEventLayers();
  const shownLayerIds = fixedEventLayers ? new Set(fixedEventLayers) : settings.shownEventLayers;
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
      layerFeatures(
        layer,
        layerEvents.get(layer.eventId)?.events ?? [],
        replayFrame?.at ?? layerClock,
      ),
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
  // The rest of the workspace (contacts, chat, emergencies) stays live while replaying.
  const items = replaying
    ? (replayFrame?.items ?? []).filter((i) => i.uid !== takSender(callsign).uid)
    : withDrafts(
        withMissionItems(liveItems, missions, shownMissions),
        activePlan ? draftItems(activePlan, liveItems) : [],
      );
  /** Where new items and changes go: the active plan, or straight to TAK. */
  const send = (event: CotEvent) => {
    if (!activePlan) return void publish(event);
    const existing = liveItems.find((i) => i.uid === event.uid) ?? missionItem(event.uid);
    const planned = activePlan.entries.some((e) => e.event.uid === event.uid);
    // Deleting an item that exists only in the plan just drops its draft.
    if (toChange(event)?.kind === "delete" && !existing && planned)
      return removeFromPlan(activePlan, event.uid);
    addToPlan(activePlan, { event, basedOn: existing?.time });
  };
  const [undoSteps, setUndoSteps] = useState<UndoStep[]>([]);
  /** Sends one action's writes and remembers how to take them back. */
  const submitAll = (events: CotEvent[]) => {
    if (events.length === 0 || replaying) return;
    // From the store and the stored plan: two quick changes would both see the last render's state.
    const changes = events.map((after) => {
      const draft = activePlan ? (draftOf(activePlan, after.uid) ?? null) : undefined;
      const drafted = draft && toChange(draft.event);
      const before =
        (drafted?.kind === "upsert" ? drafted.item : undefined) ??
        takStore.get(after.uid) ??
        missionItem(after.uid);
      return { before, after, draft };
    });
    setUndoSteps((steps) => withStep(steps, { planId: activePlan?.id, changes }));
    for (const event of events) send(event);
  };
  const submit = (event: CotEvent) => submitAll([event]);
  const submitLabel = activePlan ? `Add to ${activePlan.name}` : "Save to TAK";
  const mapRef = useRef<MapLibreMap>(undefined);
  const [map, setMap] = useState<MapLibreMap>();
  // Locate and Replay sit in MapLibre's own control stack, under zoom and compass whatever their size.
  const mapControls =
    map?.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-top-right") ?? undefined;
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
  const currentItem = (uid: string) => items.find((i) => i.uid === uid) ?? missionItem(uid);
  const selected = selectedUid ? currentItem(selectedUid) : undefined;
  const readOnlyReason = (item: TakItem) => {
    if (replayReason) return replayReason;
    if (item.team) return "A TAK user's own position comes from their device";
    if (!callsign) return "No callsign: open BattleLog from the deploy app to change TAK items";
    if (!activePlan && status.connection !== "live") return "Not connected to TAK";
  };
  const canChange = (item: TakItem) => !readOnlyReason(item);
  const latestStep = undoSteps.at(-1);
  const undoReason = replayReason
    ? replayReason
    : !callsign
      ? "No callsign: open BattleLog from the deploy app to change TAK items"
      : latestStep && latestStep.planId !== activePlan?.id
        ? latestStep.planId
          ? `The latest change went into plan ${plans.plans.find((p) => p.id === latestStep.planId)?.name ?? "(deleted)"}: make it active to undo it`
          : "The latest change went straight to TAK: switch to Live to undo it"
        : !activePlan && status.connection !== "live"
          ? "Not connected to TAK"
          : undefined;
  const undo = () => {
    if (!latestStep || undoReason) return;
    setUndoSteps(undoSteps.slice(0, -1));
    if (latestStep.planId && activePlan) {
      // A plan's undo puts its drafts back as they were; re-staging old versions would publish them.
      for (const { before, after, draft } of latestStep.changes) {
        if (before && !canChange(before)) continue;
        if (draft) addToPlan(activePlan, draft);
        else removeFromPlan(activePlan, after.uid);
      }
      return;
    }
    for (const event of undoEvents(latestStep, canChange)) send(event);
  };
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
      i.team && i.callsign && i.callsign !== callsign
        ? [{ uid: i.uid, callsign: i.callsign, team: i.team }]
        : [],
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
  const ringsKind =
    drawing.tool === "rings" || drawing.tool === "bullseye" ? drawing.tool : undefined;
  const [ringsLook, setRingsLook] = useState<RingsLook>();
  const ringsEvent = (uid?: string) => {
    if (!ringsKind || !ringsLook || drawing.drawn?.kind !== "marker") return undefined;
    const placed = { ...ringsLook, centre: drawing.drawn.position };
    if (ringsKind === "rings") return newRangeRingsEvent(placed, sender, Date.now(), uid);
    const rings = ringsLook.showRings
      ? { spacing: ringsLook.spacing, count: ringsLook.count }
      : undefined;
    return newBullseyeEvent({ ...placed, rings }, sender, Date.now(), uid);
  };
  const movedPreview = (target: Position) => {
    const by = offsetBetween(centreOfItems(movableItems), target);
    return movableItems.flatMap((item) => {
      const change = toChange(movedEvent(item, by));
      return change?.kind === "upsert" ? [change.item] : [];
    });
  };
  /** The shape being drawn as it will look once saved. */
  const previewOf = (sketch: Drawn | undefined, cursor: Position | undefined): TakItem[] => {
    if (movingGroup) return cursor ? movedPreview(cursor) : [];
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
      : ringsKind
        ? ringsEvent("preview")
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
  const ringsDialog = ringsKind && ringsLook && drawing.drawn && (
    <RingsDialog
      kind={ringsKind}
      value={ringsLook}
      onChange={setRingsLook}
      onCancel={drawing.clear}
      saveLabel={submitLabel}
      onSave={() => {
        const event = ringsEvent();
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

  /** A shape fills the view, centred; a marker is flown to at a readable zoom. */
  const centreOn = (item: TakItem) => {
    const map = mapRef.current;
    const extent = extentOf(item);
    if (!map || !extent) return hasPosition(item) && flyTo(anchorOf(item));
    // Picking opens the details panel, which narrows the map on the next frame: fit to that map.
    requestAnimationFrame(() => {
      map.resize();
      const { clientWidth: width, clientHeight: height } = map.getContainer();
      map.fitBounds(extent, {
        padding: Math.min(FIT_PADDING_PX, width / 6, height / 6),
        maxZoom: FIT_MAX_ZOOM,
        bearing: map.getBearing(),
      });
    });
  };
  const busy = !!(drawing.tool || drawing.editing || measure.active);

  // Two-way with `selection`: a change from outside selects (and shows) it here, a pick here goes out.
  const outsideKey = selection && selectionKey(selection);
  const insideKey = selectionKey({ tak: selectedUid, event: selectedEventId });
  const lastOutside = useRef<string>(undefined);
  const lastInside = useRef(insideKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new outside selection moves the map
  useEffect(() => {
    if (!selection || outsideKey === lastOutside.current) return;
    lastOutside.current = outsideKey;
    setSelectedUidState(selection.tak);
    setSelectedEventId(selection.tak ? undefined : selection.event);
    if (!centreOnSelection) return;
    const item = selection.tak && currentItem(selection.tak);
    if (item) centreOn(item);
    const point = selection.event && shownEvent(selection.event)?.locationPoint;
    if (point) flyTo([point.lng, point.lat]);
  }, [outsideKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reports picks made here, nothing else
  useEffect(() => {
    if (insideKey === lastInside.current) return;
    lastInside.current = insideKey;
    if (insideKey !== outsideKey) onSelect?.({ tak: selectedUid, event: selectedEventId });
  }, [insideKey]);

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

  const toggleDrawer = (id: DrawerId) => {
    setChatWith(undefined);
    setDrawer((open) => (open === id ? null : id));
  };

  useEffect(() => {
    if (embedded) return;
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
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z" && has("draw")) {
        e.preventDefault();
        undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "?") setShowShortcuts((open) => !open);
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
        onToggleGrouped={has("draw") && !busy ? (item) => toggleGrouped(item.uid) : undefined}
        hidden={settings.hidden}
        onToggleGroup={settings.toggleGroup}
      />
    ) : (
      <LayersDrawer
        settings={settings}
        sources={mapSources}
        map={map}
        basemap={basemap}
        clientUid={writerUid}
        eventLayers={
          <EventLayersSection
            layers={eventLayers}
            shown={shownLayerIds}
            onToggle={fixedEventLayers ? undefined : settings.toggleEventLayer}
            truncated={truncatedLayers}
          />
        }
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

  const undoButton = (
    <UndoButton
      subject={latestStep && describeStep(latestStep)}
      destination={activePlan ? `plan ${activePlan.name}` : "TAK"}
      disabledReason={undoReason}
      onUndo={undo}
    />
  );

  const eventPoint = selectedEvent?.locationPoint;
  const eventDetails = !wall && !selected && selectedEvent && (
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

  const details = !wall && selected && (
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
      replayAt={replayFrame?.at}
      onOpenEvent={selectEvent}
      onCenter={() => centreOn(selected)}
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
            if (shift && has("draw")) {
              if (uids[0]) toggleGrouped(uids[0]);
              return;
            }
            clearGroup();
            setChooser(uids.length > 1 ? { uids, at } : undefined);
            if (!uids.length && eventIds[0]) return selectEvent(eventIds[0]);
            setSelectedUid(uids.length > 1 ? selectedUid : uids[0]);
            if (!uids.length) selectEvent(undefined);
          }}
          onBoxSelect={has("draw") && !busy && !movingGroup ? addToGroup : undefined}
          onLasso={lassoing && has("draw") && !busy && !movingGroup ? addToGroup : undefined}
          onReady={(ready) => {
            mapRef.current = ready;
            setMap(ready);
            onMap?.(ready);
          }}
          view={view}
          passive={wall}
          symbolScale={wall ? WALL_SYMBOL_SCALE : 1}
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
              {!wall && (
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
              )}
              {!wall && !embedded && (
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
              )}
            </div>,
            mapControls,
          )}
        <ShortcutsDialog
          opened={showShortcuts}
          onClose={() => setShowShortcuts(false)}
          drawers={drawers.map((id) => DRAWERS[id])}
        />
        <div className="tak-overlay">
          {has("search") && (
            <div className="tak-search-slot">
              <SearchBox
                ref={searchRef}
                items={items}
                coordFormat={settings.coordFormat}
                onPickItem={pick}
                onGoTo={goTo}
              />
            </div>
          )}
          <div className="tak-banners">
            <EmergencyBanner items={liveItems} map={map} onCenter={pick} />
            {replaying && <ReplayBanner replay={replay} />}
            {!wall && <ConnectionBanner status={status} />}
          </div>
          {has("draw") && (
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

      {drawing.graphic ? tacticalDialog : ringsDialog || newItemDialog}
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
