import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconClipboardList,
  IconCrosshair,
  IconFolders,
  IconHistory,
  IconKeyboard,
  IconMap,
  IconMapPin,
  IconPencil,
  IconPlus,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { Command } from "./commands/commands.ts";
import { type CoordFormat, formatCoord, parseCoord } from "./coords.ts";
import type { Position, TakItem } from "./cot.ts";
import { TOOLS, type Tool } from "./drawing/useDrawing.ts";
import type { EventLayer } from "./event-layers/layers.ts";
import { bearing, distance, formatDistance } from "./geo.ts";
import { anchorOf, describeType, hasPosition, labelOf } from "./items.ts";
import type { MapSource } from "./map/basemaps.ts";
import type { Mission } from "./missions/missions.ts";
import { createPlan, type Plan, setActivePlan } from "./plans/plans.ts";
import type { MapSettings } from "./settings.ts";

const ICON = 16;
const MAX_ITEMS = 20;
const ITEM = "item:";

type Drawer = { id: string; label: string; key: string; Icon: ComponentType<{ size?: number }> };

/** What the command bar can reach in the workspace; each field is the workspace's own handler. */
export type WorkspaceCommands = {
  drawers: Drawer[];
  openDrawer: (id: string) => void;
  chooseTool: (tool: Tool) => void;
  drawReason: string | undefined;
  measuring: boolean;
  toggleMeasure: () => void;
  lassoing: boolean;
  toggleLasso: () => void;
  toggleDrawing: () => void;
  undo: () => void;
  undoReason: string | undefined;
  replaying: boolean;
  toggleReplay: () => void;
  toggleLocate: () => void;
  showShortcuts: () => void;
  settings: MapSettings;
  sources: MapSource[];
  basemapId: string;
  eventLayers: EventLayer[] | null;
  missions: Mission[];
  openFeed: (name: string) => void;
  plans: Plan[];
  activePlanId: string | undefined;
  openPlan: (id: string) => void;
  items: TakItem[];
  currentItem: (uid: string) => TakItem | undefined;
  coordFormat: CoordFormat;
  ownPosition: Position | undefined;
  selfCallsign: string | undefined;
  pick: (item: TakItem) => void;
  centreOn: (item: TakItem) => void;
  goTo: (position: Position) => void;
  chatWith: (item: TakItem) => void;
  tracking: (uid: string) => boolean;
  toggleTrack: ((uid: string) => void) | undefined;
  editShape: (item: TakItem) => { run: () => void; reason: string | undefined } | undefined;
};

const onOff = (on: boolean) => (on ? "On" : "Off");

const copy = (text: string, what: string) =>
  navigator.clipboard.writeText(text).then(
    () => notifications.show({ color: "success", message: `${what} copied` }),
    () => notifications.show({ color: "danger", message: `Couldn't copy the ${what}` }),
  );

/** The workspace as commands: static ones, the ones a query finds, and lookup for recents. */
export const workspaceCommands = (w: WorkspaceCommands) => {
  const where = (item: TakItem) => {
    if (!w.ownPosition || !hasPosition(item)) return "";
    const at = anchorOf(item);
    return ` · ${formatDistance(distance(w.ownPosition, at))} ${Math.round(bearing(w.ownPosition, at)) % 360}°`;
  };

  const itemActions = (item: TakItem): Command[] => {
    const name = labelOf(item);
    const edit = w.editShape(item);
    const isContact = !!item.team && !!item.callsign && item.callsign !== w.selfCallsign;
    return [
      { id: "details", group: "Items" as const, label: "Show details", run: () => w.pick(item) },
      {
        id: "centre",
        group: "Items" as const,
        label: "Centre the map on it",
        shortcut: "C",
        run: () => w.centreOn(item),
      },
      ...(isContact
        ? [
            {
              id: "chat",
              group: "Items" as const,
              label: `Chat with ${name}`,
              run: () => w.chatWith(item),
            },
          ]
        : []),
      ...(w.toggleTrack
        ? [
            {
              id: "track",
              group: "Items" as const,
              label: w.tracking(item.uid) ? "Hide its track" : "Show its track",
              run: () => w.toggleTrack?.(item.uid),
            },
          ]
        : []),
      ...(edit
        ? [
            {
              id: "edit",
              group: "Items" as const,
              label: "Edit shape",
              disabledReason: edit.reason,
              run: edit.run,
            },
          ]
        : []),
      ...(hasPosition(item)
        ? [
            {
              id: "copy-coord",
              group: "Items" as const,
              label: "Copy coordinate",
              detail: formatCoord(anchorOf(item), w.coordFormat),
              run: () => void copy(formatCoord(anchorOf(item), w.coordFormat), "Coordinate"),
            },
          ]
        : []),
      {
        id: "copy-uid",
        group: "Items" as const,
        label: "Copy UID",
        run: () => void copy(item.uid, "UID"),
      },
    ] satisfies Command[];
  };

  const itemCommand = (item: TakItem): Command => ({
    id: ITEM + item.uid,
    group: "Items" as const,
    label: labelOf(item),
    detail: describeType(item) + where(item),
    icon: <IconMapPin size={ICON} />,
    run: () => w.pick(item),
    actions: () => itemActions(item),
  });

  const search = (query: string): Command[] => {
    const q = query.trim().toLowerCase();
    const position = parseCoord(query);
    const coordinate: Command[] = position
      ? [
          {
            id: "goto",
            group: "Coordinates",
            label: `Go to ${formatCoord(position, w.coordFormat)}`,
            icon: <IconCrosshair size={ICON} />,
            // Matched by parsing, not by label.
            keywords: [q],
            run: () => w.goTo(position),
          },
        ]
      : [];
    const items = w.items
      .filter((i) => labelOf(i).toLowerCase().includes(q) || i.uid.toLowerCase() === q)
      .slice(0, MAX_ITEMS)
      .map((i) => ({ ...itemCommand(i), keywords: [i.uid] }));
    return [...coordinate, ...items];
  };

  const { settings } = w;
  const drawIcon = <IconPencil size={ICON} />;
  const mapIcon = <IconMap size={ICON} />;
  const commands: Command[] = [
    ...w.drawers.map(({ id, label, key, Icon }) => ({
      id: `drawer:${id}`,
      group: "Go to" as const,
      label,
      shortcut: key,
      icon: <Icon size={ICON} />,
      run: () => w.openDrawer(id),
    })),
    ...(Object.keys(TOOLS) as Tool[]).map((tool) => ({
      id: `draw:${tool}`,
      group: "Draw" as const,
      label: TOOLS[tool].label,
      keywords: ["draw", "new"],
      icon: drawIcon,
      disabledReason: w.drawReason,
      run: () => w.chooseTool(tool),
    })),
    {
      id: "draw:measure",
      group: "Draw",
      label: w.measuring ? "Stop measuring" : "Measure",
      keywords: ["distance", "range", "bearing"],
      icon: drawIcon,
      run: w.toggleMeasure,
    },
    {
      id: "draw:lasso",
      group: "Draw",
      label: w.lassoing ? "Stop lasso select" : "Lasso select",
      keywords: ["select"],
      icon: drawIcon,
      run: w.toggleLasso,
    },
    {
      id: "map:mgrs",
      group: "Map",
      label: "MGRS grid",
      detail: onOff(settings.mgrsGrid),
      keywords: ["grid"],
      icon: mapIcon,
      run: () => settings.setMgrsGrid(!settings.mgrsGrid),
    },
    {
      id: "map:tracks",
      group: "Map",
      label: "Tracks",
      detail: onOff(settings.showAllTracks),
      icon: mapIcon,
      run: () => settings.setShowAllTracks(!settings.showAllTracks),
    },
    {
      id: "map:dim",
      group: "Map",
      label: "Dim background map",
      detail: onOff(settings.dim),
      keywords: ["night", "dark"],
      icon: mapIcon,
      run: () => settings.setDim(!settings.dim),
    },
    ...w.sources.map((source) => ({
      id: `map:basemap:${source.id}`,
      group: "Map" as const,
      label: source.label,
      detail: source.id === w.basemapId ? "Background map now" : "Background map",
      keywords: ["background", "basemap"],
      icon: mapIcon,
      run: () => settings.setBasemap(source.id),
    })),
    ...(w.eventLayers ?? []).map((layer) => ({
      id: `map:layer:${layer.eventId}`,
      group: "Map" as const,
      label: layer.definition.name || "(unnamed)",
      detail: `BattleLog layer · ${onOff(settings.shownEventLayers.has(layer.eventId))}`,
      keywords: ["layer"],
      icon: mapIcon,
      run: () => settings.toggleEventLayer(layer.eventId),
    })),
    ...w.missions.map((mission) => ({
      id: `feed:${mission.name}`,
      group: "Data Sync feeds" as const,
      label: mission.name,
      detail: mission.description,
      keywords: ["feed", "mission", ...mission.keywords],
      icon: <IconFolders size={ICON} />,
      run: () => w.openFeed(mission.name),
    })),
    ...w.plans.map((plan) => {
      const active = plan.id === w.activePlanId;
      return {
        id: `plan:${plan.id}`,
        group: "Plans" as const,
        label: plan.name,
        detail: active ? "Drawing into it now" : `${plan.entries.length} items`,
        keywords: ["plan"],
        icon: <IconClipboardList size={ICON} />,
        run: () => w.openPlan(plan.id),
        actions: (): Command[] => [
          { id: "open", group: "Plans", label: "Open", run: () => w.openPlan(plan.id) },
          {
            id: "activate",
            group: "Plans",
            label: active ? "Stop drawing into it" : "Draw and edit into it",
            run: () => setActivePlan(active ? undefined : plan.id),
          },
        ],
      };
    }),
    {
      id: "action:new-plan",
      group: "Actions",
      label: "New plan",
      icon: <IconPlus size={ICON} />,
      run: () => w.openPlan(createPlan(`Plan ${w.plans.length + 1}`).id),
    },
    {
      id: "action:drawing-tools",
      group: "Actions",
      label: "Drawing tools",
      shortcut: "D",
      icon: drawIcon,
      run: w.toggleDrawing,
    },
    {
      id: "action:undo",
      group: "Actions",
      label: "Undo",
      shortcut: "Ctrl/⌘ Z",
      icon: <IconArrowBackUp size={ICON} />,
      disabledReason: w.undoReason,
      run: w.undo,
    },
    {
      id: "action:replay",
      group: "Actions",
      label: w.replaying ? "Back to live" : "Replay history",
      keywords: ["history", "time"],
      icon: <IconHistory size={ICON} />,
      run: w.toggleReplay,
    },
    {
      id: "action:locate",
      group: "Actions",
      label: "Locate me",
      keywords: ["gps", "position"],
      icon: <IconCrosshair size={ICON} />,
      run: w.toggleLocate,
    },
    {
      id: "action:shortcuts",
      group: "Actions",
      label: "Keyboard shortcuts",
      shortcut: "?",
      keywords: ["help", "keys"],
      icon: <IconKeyboard size={ICON} />,
      run: w.showShortcuts,
    },
  ];

  const byId = (id: string) => {
    if (!id.startsWith(ITEM)) return commands.find((c) => c.id === id);
    const item = w.currentItem(id.slice(ITEM.length));
    return item && itemCommand(item);
  };

  return { commands, search, byId };
};
