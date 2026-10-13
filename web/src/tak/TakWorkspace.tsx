import "./tak.css";
import {
  Alert,
  Button,
  CloseButton,
  Drawer,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconClipboardList,
  IconFolders,
  IconList,
  IconStack2,
} from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useIsMobile } from "../dashboard/mobile.ts";
import { publish } from "./commands.ts";
import { type CotEvent, type Position, type TakItem, toChange } from "./cot.ts";
import { sendTestMarker } from "./dev-test-write.ts";
import { DrawToolbar } from "./drawing/DrawToolbar.tsx";
import { MeasurePanel } from "./drawing/MeasurePanel.tsx";
import { NewItemDialog } from "./drawing/NewItemDialog.tsx";
import { newMarkerEvent, newRangeBearingEvent, newShapeEvent } from "./drawing/new-items.ts";
import { useDrawing } from "./drawing/useDrawing.ts";
import { useMeasure } from "./drawing/useMeasure.ts";
import { useCallsign } from "./identity.ts";
import { ItemDetails } from "./items/ItemDetails.tsx";
import { ItemsDrawer } from "./items/ItemsDrawer.tsx";
import { anchorOf, hasPosition } from "./items.ts";
import { LayersDrawer } from "./map/LayersDrawer.tsx";
import { MapCanvas } from "./map/MapCanvas.tsx";
import { PickChooser } from "./map/PickChooser.tsx";
import { MissionsDrawer } from "./missions/MissionsDrawer.tsx";
import { type MissionsState, useMissions, useMissionsSync } from "./missions/store.ts";
import { PlansDrawer } from "./plans/PlansDrawer.tsx";
import { addToPlan, type Plan, usePlans } from "./plans/plans.ts";
import { SearchBox } from "./SearchBox.tsx";
import { StatusBar } from "./StatusBar.tsx";
import {
  loadTrack,
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
} as const;

type DrawerId = keyof typeof DRAWERS;

const FOCUS_ZOOM = 14;

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

/** A plan's drafts as map items, named so they can't be mistaken for what TAK has. */
const draftItems = (plan: Plan, live: TakItem[]) =>
  plan.entries.flatMap(({ event, basedOn }) => {
    const change = toChange(event);
    if (change?.kind !== "upsert") return [];
    const item: TakItem = { ...change.item, draft: true };
    const current = live.find((i) => i.uid === event.uid);
    return [{ item, conflict: basedOn !== undefined && !!current && current.time > basedOn }];
  });

/** Live items with the active plan's drafts in place of (or beside) them. */
const withDrafts = (items: TakItem[], drafts: TakItem[]) => {
  if (drafts.length === 0) return items;
  const drafted = new Set(drafts.map((d) => d.uid));
  return [...items.filter((i) => !drafted.has(i.uid)), ...drafts];
};

const ConnectionBanner = ({ status }: { status: TakStatus }) => {
  if (status.connection !== "down") return null;
  return (
    <Alert
      className="tak-banner"
      color="danger"
      variant="filled"
      icon={<IconAlertTriangle size={18} />}
    >
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
};

/**
 * The TAK client: map, item list, layers and item details around one shared
 * TAK session. The Map page shows all of it; a dashboard widget shows the
 * tools it was configured with.
 */
export const TakWorkspace = ({ tools, view, embedded, onMap }: Props) => {
  const has = (tool: TakTool) => !tools || tools.has(tool);
  const drawers = (Object.keys(DRAWERS) as DrawerId[]).filter(has);
  useTakSession();
  const liveItems = useTakItems();
  const tracks = useTakTracks();
  const [trackedUids, setTrackedUids] = useState<ReadonlySet<string>>(new Set());
  const status = useTakStatus();
  const callsign = useCallsign();
  const settings = useMapSettings();
  const isMobile = useIsMobile();
  const [drawer, setDrawer] = useState<DrawerId | null>(isMobile || !has("items") ? null : "items");
  const [selectedUid, setSelectedUid] = useState<string>();
  const [chooser, setChooser] = useState<{ uids: string[]; at: { x: number; y: number } }>();
  const [cursor, setCursor] = useState<Position>();
  const [openMission, setOpenMission] = useState<string>();
  const browsedMission = drawer === "missions" ? openMission : undefined;
  useMissionsSync([...settings.shownMissions, ...(browsedMission ? [browsedMission] : [])]);
  const missions = useMissions();
  const plans = usePlans();
  // Without the plans tool there's no sign of a plan, so nothing may quietly go into one.
  const activePlan = has("plans") ? plans.plans.find((p) => p.id === plans.activeId) : undefined;
  const items = withDrafts(
    withMissionItems(liveItems, missions, settings.shownMissions),
    activePlan ? draftItems(activePlan, liveItems).map((d) => d.item) : [],
  );
  /** Where new items and changes go: the active plan, or straight to TAK. */
  const submit = (event: CotEvent) => {
    if (!activePlan) return void publish(event);
    const existing = liveItems.find((i) => i.uid === event.uid);
    addToPlan(activePlan, { event, basedOn: existing?.time });
  };
  const submitLabel = activePlan ? `Add to ${activePlan.name}` : "Save to TAK";
  const mapRef = useRef<MapLibreMap>(undefined);
  const [map, setMap] = useState<MapLibreMap>();
  const drawing = useDrawing(map);
  const measure = useMeasure(map);
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
  const contacts = [
    ...new Set(
      liveItems.flatMap((i) =>
        i.team && i.callsign && i.callsign !== callsign ? [i.callsign] : [],
      ),
    ),
  ].sort();
  const drawReason = !callsign
    ? "No callsign: open BattleLog from the deploy app to draw on TAK"
    : status.connection !== "live"
      ? "Not connected to TAK"
      : undefined;
  const sender = { uid: `BattleLog-${callsign}`, callsign: callsign ?? "" };
  const nameFor = (label: string) =>
    `${label} ${liveItems.filter((i) => i.callsign?.startsWith(`${label} `)).length + 1}`;
  const newItemDialog = drawing.drawn && (
    <NewItemDialog
      drawn={drawing.drawn}
      defaultName={nameFor(
        {
          marker: "Marker",
          line: "Line",
          polygon: "Area",
          rectangle: "Rectangle",
          circle: "Circle",
        }[drawing.drawn.kind],
      )}
      onCancel={drawing.clear}
      saveLabel={submitLabel}
      onSaveShape={(style) => {
        if (drawing.drawn && drawing.drawn.kind !== "marker")
          submit(newShapeEvent(drawing.drawn, style, sender));
        drawing.clear();
      }}
      onSaveMarker={(marker) => {
        if (drawing.drawn?.kind === "marker")
          submit(newMarkerEvent({ ...marker, position: drawing.drawn.position }, sender));
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

  const toggleDrawer = (id: DrawerId) => setDrawer((open) => (open === id ? null : id));

  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (chooser) setChooser(undefined);
        else if (measure.active) measure.stop();
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
    id === "plans" ? (
      <PlansDrawer
        state={plans}
        draftsOf={(plan) => draftItems(plan, liveItems)}
        selectedUid={selectedUid}
        onPick={pick}
        publishReason={drawReason}
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
      <LayersDrawer settings={settings}>
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

  const details = selected && (
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
      onSubmit={submit}
      submitLabel={submitLabel}
      livePhotos={!activePlan}
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
              <Icon size={20} stroke={1.5} />
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
          items={items}
          tracks={trackFeatures(
            settings.showAllTracks ? items : items.filter((i) => trackedUids.has(i.uid)),
            tracks,
            settings.hidden,
          )}
          hidden={settings.hidden}
          basemap={settings.basemap}
          dim={settings.dim}
          selectedUid={selectedUid}
          onPick={(uids, at) => {
            if (drawing.tool || measure.active) return;
            setChooser(uids.length > 1 ? { uids, at } : undefined);
            setSelectedUid(uids.length > 1 ? selectedUid : uids[0]);
          }}
          onCursor={setCursor}
          onReady={(ready) => {
            mapRef.current = ready;
            setMap(ready);
            onMap?.(ready);
          }}
          view={view}
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
            disabledReason={activePlan ? undefined : drawReason}
            planName={activePlan?.name}
            measuring={measure.active}
            onToggleMeasure={() => {
              if (measure.active) return measure.stop();
              drawing.choose(undefined);
              measure.start();
            }}
          >
            <MeasurePanel
              points={measure.points}
              cursor={measure.cursor}
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
        <ConnectionBanner status={status} />
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

      {newItemDialog}
      <StatusBar
        status={status}
        callsign={callsign}
        cursor={cursor}
        coordFormat={settings.coordFormat}
        itemCount={items.length}
      />
    </div>
  );
};
