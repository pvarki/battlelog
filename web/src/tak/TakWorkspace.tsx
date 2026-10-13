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
import { IconAlertTriangle, IconFolders, IconList, IconStack2 } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useIsMobile } from "../dashboard/mobile.ts";
import type { Position, TakItem } from "./cot.ts";
import { sendTestMarker } from "./dev-test-write.ts";
import { useCallsign } from "./identity.ts";
import { ItemDetails } from "./items/ItemDetails.tsx";
import { ItemsDrawer } from "./items/ItemsDrawer.tsx";
import { anchorOf, hasPosition } from "./items.ts";
import { LayersDrawer } from "./map/LayersDrawer.tsx";
import { MapCanvas } from "./map/MapCanvas.tsx";
import { MissionsDrawer } from "./missions/MissionsDrawer.tsx";
import { type MissionsState, useMissions, useMissionsSync } from "./missions/store.ts";
import { SearchBox } from "./SearchBox.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { type TakStatus, useTakItems, useTakSession, useTakStatus } from "./session.ts";
import { useMapSettings } from "./settings.ts";

const DRAWERS = {
  items: { label: "Items", Icon: IconList, key: "1" },
  missions: { label: "Missions", Icon: IconFolders, key: "2" },
  layers: { label: "Layers", Icon: IconStack2, key: "3" },
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

/**
 * The TAK client: map, item list, layers and item details around one shared
 * TAK session. The Map page shows all of it; a dashboard widget will reuse it
 * with fewer features switched on.
 */
export const TakWorkspace = () => {
  useTakSession();
  const liveItems = useTakItems();
  const status = useTakStatus();
  const callsign = useCallsign();
  const settings = useMapSettings();
  const isMobile = useIsMobile();
  const [drawer, setDrawer] = useState<DrawerId | null>(isMobile ? null : "items");
  const [selectedUid, setSelectedUid] = useState<string>();
  const [cursor, setCursor] = useState<Position>();
  const [openMission, setOpenMission] = useState<string>();
  const browsedMission = drawer === "missions" ? openMission : undefined;
  useMissionsSync([...settings.shownMissions, ...(browsedMission ? [browsedMission] : [])]);
  const missions = useMissions();
  const items = withMissionItems(liveItems, missions, settings.shownMissions);
  const mapRef = useRef<MapLibreMap>(undefined);
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
    if (status.connection !== "live") return "Not connected to TAK";
  };
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

  const toggleDrawer = (id: DrawerId) => setDrawer((open) => (open === id ? null : id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedUid) setSelectedUid(undefined);
        else setDrawer(null);
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      for (const [id, { key }] of Object.entries(DRAWERS)) {
        if (e.key === key) toggleDrawer(id as DrawerId);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const drawerContent = (id: DrawerId) =>
    id === "missions" ? (
      <MissionsDrawer
        state={missions}
        shown={settings.shownMissions}
        onToggleShown={settings.toggleMission}
        open={openMission}
        onOpen={setOpenMission}
        selectedUid={selectedUid}
        onPick={pick}
        callsignOf={callsignOf}
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
      readOnlyReason={readOnlyReason(selected)}
      callsign={callsign}
      onCenter={() => flyTo(anchorOf(selected))}
      onClose={() => setSelectedUid(undefined)}
    />
  );

  return (
    <div className="tak-workspace" data-mobile={isMobile || undefined}>
      <nav className="tak-rail" aria-label="Map tools">
        {(Object.keys(DRAWERS) as DrawerId[]).map((id) => {
          const { label, Icon, key } = DRAWERS[id];
          return (
            <UnstyledButton
              key={id}
              className="tak-rail-button"
              aria-pressed={drawer === id}
              onClick={() => toggleDrawer(id)}
              title={`${label} (${key})`}
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
          hidden={settings.hidden}
          basemap={settings.basemap}
          dim={settings.dim}
          selectedUid={selectedUid}
          onSelect={setSelectedUid}
          onCursor={setCursor}
          onReady={(map) => {
            mapRef.current = map;
          }}
        />
        <div className="tak-search-slot">
          <SearchBox
            ref={searchRef}
            items={items}
            coordFormat={settings.coordFormat}
            onPickItem={pick}
            onGoTo={flyTo}
          />
        </div>
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
