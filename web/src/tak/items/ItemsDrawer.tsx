import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Chip,
  Group,
  Menu,
  Pill,
  Popover,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
  IconArrowsSort,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFilter,
  IconSearch,
} from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Placeholder } from "../../components/Placeholder.tsx";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { formatAge } from "../../time.ts";
import { useNow } from "../../use-now.ts";
import type { Position, TakItem } from "../cot.ts";
import { download } from "../download.ts";
import { bearing, distance, formatDistance } from "../geo.ts";
import {
  anchorOf,
  describeType,
  hasPosition,
  type ItemStatus,
  labelOf,
  STATUS_LABEL,
  statusOf,
  teamColor,
} from "../items.ts";
import { useMapView } from "../map/camera.ts";
import { groupOf, groupTree, isHidden, type Group as OverlayGroup } from "../overlays.ts";
import { PanelActions, ViewMenu, ViewOption } from "../panel.tsx";
import { kmlBlob } from "../plans/overlay-files.ts";
import {
  type Affiliation,
  activeFilters,
  byName,
  feedSource,
  type ItemFilters,
  type ItemKind,
  type ItemSort,
  matchesFilters,
  NO_FILTERS,
  PLAN_SOURCE,
  sortFlat,
} from "./item-filters.ts";

type Props = {
  items: TakItem[];
  selectedUid: string | undefined;
  onPick: (item: TakItem) => void;
  /** Items picked together with Shift-click, to move or delete as a group. */
  grouped?: ReadonlySet<string>;
  onToggleGrouped?: (item: TakItem) => void;
  hidden: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  map: MapLibreMap | undefined;
  /** Distances are measured from here when known, else from the map centre. */
  ownPosition: Position | undefined;
  /** Item uids per Data Sync feed, for the Source filter. */
  feeds: ReadonlyMap<string, ReadonlySet<string>>;
};

// Groups holding more items than this start collapsed: thousands of rows bury the handful that matter.
const BIG_GROUP = 300;

const matches = (item: TakItem, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [labelOf(item), item.team, describeType(item), item.uid].some((s) =>
    s?.toLowerCase().includes(q),
  );
};

/** Stale or disconnected; nothing while online. */
export const StatusBadge = ({ status }: { status: ItemStatus }) =>
  status === "online" ? null : (
    <Badge
      size="xs"
      variant="outline"
      tt="none"
      color={status === "offline" ? "gray" : "warning"}
      style={{ flexShrink: 0 }}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );

export const ItemRow = ({
  item,
  selected,
  now,
  from,
  compact,
  onPick,
}: {
  item: TakItem;
  selected: boolean;
  now: number;
  /** Shows the distance and bearing from here. */
  from?: Position;
  /** One line: name, distance and age. */
  compact?: boolean;
  onPick: (event: MouseEvent) => void;
}) => {
  const status = statusOf(item, now);
  const at = from && hasPosition(item) ? anchorOf(item) : undefined;
  if (compact)
    return (
      <UnstyledButton
        className="tak-row"
        data-selected={selected || undefined}
        data-faded={status !== "online" || undefined}
        onClick={onPick}
        aria-current={selected || undefined}
        title={item.team ? `${item.team}${item.role ? ` · ${item.role}` : ""}` : describeType(item)}
      >
        <Group gap="xs" wrap="nowrap">
          <Text fz="sm" fw={500} truncate style={{ flex: 1, minWidth: 0 }}>
            {labelOf(item)}
          </Text>
          <Text fz="xs" c="dimmed" className="tak-mono" style={{ flexShrink: 0 }}>
            {from && at ? `${formatDistance(distance(from, at))} · ` : ""}
            {formatAge(now - item.time)}
          </Text>
          <StatusBadge status={status} />
        </Group>
      </UnstyledButton>
    );
  return (
    <UnstyledButton
      className="tak-row"
      data-selected={selected || undefined}
      data-faded={status !== "online" || undefined}
      onClick={onPick}
      aria-current={selected || undefined}
    >
      <Group gap="xs" wrap="nowrap" justify="space-between">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text fz="sm" fw={500} truncate>
            {labelOf(item)}
          </Text>
          <Text fz="xs" c="dimmed" truncate>
            {item.team ? (
              <>
                <span className="tak-swatch" style={{ background: teamColor(item.team) }} />
                {item.team}
                {item.role ? ` · ${item.role}` : ""}
              </>
            ) : (
              describeType(item)
            )}
          </Text>
        </Stack>
        <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
          {from && at && (
            <Text fz="xs" c="dimmed" className="tak-mono">
              {formatDistance(distance(from, at))} · {Math.round(bearing(from, at)) % 360}°
            </Text>
          )}
          <Group gap={4} wrap="nowrap">
            <Text fz="xs" c="dimmed">
              {formatAge(now - item.time)}
            </Text>
            <StatusBadge status={status} />
          </Group>
        </Stack>
      </Group>
    </UnstyledButton>
  );
};

type Row = { key: string; depth: number; dimmed: boolean } & (
  | { kind: "group"; group: OverlayGroup; open: boolean; ownHidden: boolean }
  | { kind: "item"; item: TakItem }
);

/** The tree as the rows on screen, so only those in view are rendered. */
const flatten = (
  groups: OverlayGroup[],
  isOpen: (group: OverlayGroup) => boolean,
  hidden: ReadonlySet<string>,
  depth = 0,
  parentHidden = false,
): Row[] =>
  groups.flatMap((group) => {
    const ownHidden = hidden.has(group.key);
    const open = isOpen(group);
    const dimmed = ownHidden || parentHidden;
    const header: Row = { kind: "group", key: group.key, group, open, ownHidden, depth, dimmed };
    if (!open) return [header];
    return [
      header,
      ...flatten(group.children, isOpen, hidden, depth + 1, dimmed),
      ...group.items
        .sort(byName)
        .map((item): Row => ({ kind: "item", key: item.uid, item, depth: depth + 1, dimmed })),
    ];
  });

const SORT_OPTIONS: { value: ItemSort; label: string }[] = [
  { value: "name", label: "Grouped" },
  { value: "newest", label: "Newest" },
  { value: "distance", label: "Nearest" },
];

const STATUS_OPTIONS: ItemStatus[] = ["online", "stale", "offline"];
const AFFILIATION_OPTIONS: { value: Affiliation; label: string }[] = [
  { value: "friendly", label: "Friendly" },
  { value: "hostile", label: "Hostile" },
  { value: "neutral", label: "Neutral" },
  { value: "unknown", label: "Unknown" },
];
const KIND_OPTIONS: { value: ItemKind; label: string }[] = [
  { value: "people", label: "People" },
  { value: "markers", label: "Markers" },
  { value: "shapes", label: "Shapes" },
  { value: "routes", label: "Routes" },
];
const UPDATED_OPTIONS = [
  { value: "", label: "Any" },
  { value: "15", label: "15 min" },
  { value: "60", label: "1 h" },
  { value: "1440", label: "24 h" },
];

const FilterChips = <T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
}) => (
  <Stack gap={4}>
    <SectionHeading>{label}</SectionHeading>
    <Chip.Group multiple value={value} onChange={(v) => onChange(v as T[])}>
      <Group gap={4}>
        {options.map((o) => (
          <Chip key={o.value} value={o.value} size="xs">
            {o.label}
          </Chip>
        ))}
      </Group>
    </Chip.Group>
  </Stack>
);

const FiltersMenu = ({
  filters,
  setFilters,
  sources,
}: {
  filters: ItemFilters;
  setFilters: (update: Partial<ItemFilters>) => void;
  sources: { value: string; label: string }[];
}) => {
  const count = activeFilters(filters);
  return (
    <Popover position="bottom-end" width={280} shadow="md" withinPortal>
      <Popover.Target>
        <ActionIcon
          variant={count > 0 ? "light" : "subtle"}
          color={count > 0 ? "accent" : "gray"}
          size="sm"
          aria-label={count > 0 ? `Filters, ${count} on` : "Filters"}
          title="Filters"
        >
          <IconFilter size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Switch
            size="xs"
            label="Only what's in the map view"
            checked={filters.inView}
            onChange={(e) => setFilters({ inView: e.currentTarget.checked })}
          />
          <FilterChips
            label="Status"
            options={STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            value={filters.statuses}
            onChange={(statuses) => setFilters({ statuses })}
          />
          <FilterChips
            label="Affiliation"
            options={AFFILIATION_OPTIONS}
            value={filters.affiliations}
            onChange={(affiliations) => setFilters({ affiliations })}
          />
          <FilterChips
            label="Kind"
            options={KIND_OPTIONS}
            value={filters.kinds}
            onChange={(kinds) => setFilters({ kinds })}
          />
          <Stack gap={4}>
            <SectionHeading>Updated within</SectionHeading>
            <SegmentedControl
              size="xs"
              fullWidth
              data={UPDATED_OPTIONS}
              value={filters.updatedWithin === null ? "" : String(filters.updatedWithin)}
              onChange={(v) => setFilters({ updatedWithin: v ? Number(v) : null })}
            />
          </Stack>
          {sources.length > 0 && (
            <FilterChips
              label="Source"
              options={sources}
              value={filters.sources}
              onChange={(chosen) => setFilters({ sources: chosen })}
            />
          )}
          <Button
            size="xs"
            variant="default"
            disabled={count === 0}
            onClick={() => setFilters(NO_FILTERS)}
          >
            Clear filters
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

/** Every item in ATAK's overlay groups: the keyboard route to anything on the map, and what it shows. */
export const ItemsDrawer = ({
  items,
  selectedUid,
  onPick,
  grouped,
  onToggleGrouped,
  hidden,
  onToggleGroup,
  map,
  ownPosition,
  feeds,
}: Props) => {
  const [query, setQuery] = useState("");
  const [storedFilters, setStoredFilters] = useLocalStorage<ItemFilters>({
    key: "battlelog.tak.items.filters",
    defaultValue: NO_FILTERS,
  });
  const filters = { ...NO_FILTERS, ...storedFilters };
  const setFilters = (update: Partial<ItemFilters>) =>
    setStoredFilters((current) => ({ ...NO_FILTERS, ...current, ...update }));
  const [sort, setSort] = useLocalStorage<ItemSort>({
    key: "battlelog.tak.items.sort",
    defaultValue: "name",
  });
  /** Groups the user opened or closed; the rest follow the BIG_GROUP rule. */
  const [groupOpen, setGroupOpen] = useLocalStorage<Record<string, boolean>>({
    key: "battlelog.tak.items.groupsOpen",
    defaultValue: {},
  });
  const [compact, setCompact] = useLocalStorage({
    key: "battlelog.tak.items.compact",
    defaultValue: false,
  });
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  /** The keyboard cursor, by row key so new rows can't shift it onto another item. */
  const [activeKey, setActiveKey] = useState<string>();
  const list = useRef<VirtuosoHandle>(null);
  const now = useNow(10_000);
  const view = useMapView(map);
  const from = ownPosition ?? view?.centre;
  const searching = query.trim() !== "";
  const listed = items.filter(
    (i) => matches(i, query) && matchesFilters(i, filters, { now, view: view?.bounds, feeds }),
  );
  const isOpen = (group: OverlayGroup) =>
    searching || (groupOpen[group.key] ?? group.items.length <= BIG_GROUP);
  const rows: Row[] =
    sort === "name"
      ? flatten(groupTree(listed), isOpen, hidden)
      : sortFlat(listed, sort, from).map((item) => ({
          kind: "item",
          key: item.uid,
          item,
          depth: 0,
          dimmed: isHidden(groupOf(item), hidden),
        }));
  const shown = listed.filter((i) => !isHidden(groupOf(i), hidden));
  const sources = [
    ...(items.some((i) => i.draft) ? [{ value: PLAN_SOURCE, label: "Plan drafts" }] : []),
    ...[...feeds.keys()].sort().map((name) => ({ value: feedSource(name), label: name })),
  ];
  const without = <T,>(list: T[], value: T) => list.filter((v) => v !== value);
  const pills: { key: string; label: string; onRemove: () => void }[] = [
    ...(filters.inView
      ? [{ key: "view", label: "In view", onRemove: () => setFilters({ inView: false }) }]
      : []),
    ...filters.statuses.map((v) => ({
      key: `status ${v}`,
      label: STATUS_LABEL[v],
      onRemove: () => setFilters({ statuses: without(filters.statuses, v) }),
    })),
    ...filters.affiliations.map((v) => ({
      key: `affiliation ${v}`,
      label: AFFILIATION_OPTIONS.find((o) => o.value === v)?.label ?? v,
      onRemove: () => setFilters({ affiliations: without(filters.affiliations, v) }),
    })),
    ...filters.kinds.map((v) => ({
      key: `kind ${v}`,
      label: KIND_OPTIONS.find((o) => o.value === v)?.label ?? v,
      onRemove: () => setFilters({ kinds: without(filters.kinds, v) }),
    })),
    ...(filters.updatedWithin !== null
      ? [
          {
            key: "updated",
            label: `Last ${UPDATED_OPTIONS.find((o) => o.value === String(filters.updatedWithin))?.label ?? `${filters.updatedWithin} min`}`,
            onRemove: () => setFilters({ updatedWithin: null }),
          },
        ]
      : []),
    ...filters.sources.map((v) => ({
      key: `source ${v}`,
      label: sources.find((o) => o.value === v)?.label ?? v,
      onRemove: () => setFilters({ sources: without(filters.sources, v) }),
    })),
    ...(sort === "name"
      ? []
      : [
          {
            key: "sort",
            label:
              sort === "newest"
                ? "Newest first"
                : `Nearest to ${ownPosition ? "you" : "map centre"}`,
            onRemove: () => setSort("name"),
          },
        ]),
  ];
  const active = activeKey === undefined ? -1 : rows.findIndex((r) => r.key === activeKey);

  const setOpen = (key: string, open: boolean) =>
    setGroupOpen((current) => ({ ...current, [key]: open }));
  const groupKeys = (groups: OverlayGroup[]): string[] =>
    groups.flatMap((g) => [g.key, ...groupKeys(g.children)]);
  const setAllOpen = (open: boolean) =>
    setGroupOpen((current) => ({
      ...current,
      ...Object.fromEntries(groupKeys(groupTree(listed)).map((key) => [key, open])),
    }));

  // An item picked elsewhere (map, search, a link) opens its groups here and scrolls into view, once per pick.
  const pickedHere = useRef<string>(undefined);
  const scrollPending = useRef<string>(undefined);
  const selectedPresent = items.some((i) => i.uid === selectedUid);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pick, or its item arriving, opens groups; not every picture update
  useEffect(() => {
    if (selectedUid === pickedHere.current) return;
    scrollPending.current = selectedUid;
    const item = selectedUid && items.find((i) => i.uid === selectedUid);
    if (!item || sort !== "name") return;
    const path = groupOf(item);
    const closed = path.map((_, i) => path.slice(0, i + 1).join("/")).filter((k) => !groupOpen[k]);
    if (closed.length)
      setGroupOpen((current) => ({
        ...current,
        ...Object.fromEntries(closed.map((key) => [key, true])),
      }));
  }, [selectedUid, selectedPresent]);
  const selectedIndex = rows.findIndex((r) => r.kind === "item" && r.item.uid === selectedUid);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list mounts with the viewport, so a pick made before then scrolls once it can
  useEffect(() => {
    if (scrollPending.current === undefined || selectedIndex < 0 || !list.current) return;
    scrollPending.current = undefined;
    list.current.scrollIntoView({ index: selectedIndex, align: "center" });
  }, [selectedIndex, viewport]);

  const pickRow = (row: Row, event?: { shiftKey: boolean }) => {
    if (row.kind === "group") return setOpen(row.group.key, !row.open);
    pickedHere.current = row.item.uid;
    (event?.shiftKey && onToggleGrouped ? onToggleGrouped : onPick)(row.item);
  };

  const moveActive = (to: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, to));
    setActiveKey(rows[next]?.key);
    list.current?.scrollIntoView({ index: next });
  };

  const onListKey = (e: KeyboardEvent) => {
    // A focused eye button keeps its own keys.
    if (e.target !== e.currentTarget) return;
    const row = rows[active];
    if (e.key === "ArrowDown") moveActive(active + 1);
    else if (e.key === "ArrowUp") moveActive(active < 0 ? 0 : active - 1);
    else if (e.key === "Home") moveActive(0);
    else if (e.key === "End") moveActive(rows.length - 1);
    else if (e.key === "Enter" && row) pickRow(row, e);
    else if (e.key === "ArrowLeft" && row?.kind === "group" && row.open)
      setOpen(row.group.key, false);
    else if (e.key === "ArrowRight" && row?.kind === "group" && !row.open)
      setOpen(row.group.key, true);
    else return;
    e.preventDefault();
  };

  const renderRow = (row: Row) => {
    if (row.kind === "item")
      return (
        <ItemRow
          item={row.item}
          now={now}
          from={from}
          compact={compact}
          selected={row.item.uid === selectedUid || !!grouped?.has(row.item.uid)}
          onPick={(e) => pickRow(row, e)}
        />
      );
    const { group, open, ownHidden } = row;
    return (
      <div className="tak-group-header">
        <UnstyledButton
          className="tak-group-toggle"
          aria-expanded={open}
          disabled={searching}
          tabIndex={-1}
          onClick={() => setOpen(group.key, !open)}
        >
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          {group.key.startsWith("markers/team/") && (
            <span className="tak-swatch" style={{ background: teamColor(group.label) }} />
          )}
          {group.label} <span className="tak-group-count">{group.count}</span>
        </UnstyledButton>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={`Show ${group.label} on the map`}
          aria-pressed={!ownHidden}
          title={ownHidden ? "Not on the map" : "Shown on the map"}
          onClick={() => onToggleGroup(group.key)}
        >
          {ownHidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </ActionIcon>
      </div>
    );
  };

  const treeShown = sort === "name" && !searching;

  return (
    <Stack gap="xs" h="100%">
      <PanelActions>
        <ViewMenu>
          <ViewOption checked={compact} onChange={setCompact}>
            Compact rows
          </ViewOption>
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconChevronDown size={14} />}
            disabled={!treeShown}
            onClick={() => setAllOpen(true)}
          >
            Expand all groups
          </Menu.Item>
          <Menu.Item
            leftSection={<IconChevronRight size={14} />}
            disabled={!treeShown}
            onClick={() => setAllOpen(false)}
          >
            Collapse all groups
          </Menu.Item>
        </ViewMenu>
      </PanelActions>
      <TextInput
        size="xs"
        placeholder="Filter by name, team or type"
        aria-label="Filter items"
        leftSection={<IconSearch size={14} />}
        rightSectionWidth={56}
        rightSectionPointerEvents="all"
        rightSection={
          <Group gap={2} wrap="nowrap">
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant={sort === "name" ? "subtle" : "light"}
                  color={sort === "name" ? "gray" : "accent"}
                  size="sm"
                  aria-label="Sort items"
                  title="Sort"
                >
                  <IconArrowsSort size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Sort</Menu.Label>
                {SORT_OPTIONS.map((o) => (
                  <Menu.Item
                    key={o.value}
                    rightSection={o.value === sort ? <IconCheck size={14} /> : undefined}
                    onClick={() => setSort(o.value)}
                  >
                    {o.label}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            <FiltersMenu filters={filters} setFilters={setFilters} sources={sources} />
          </Group>
        }
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" || rows.length === 0) return;
          e.preventDefault();
          viewport?.closest<HTMLElement>("[data-items-list]")?.focus();
          moveActive(0);
        }}
      />
      {(pills.length > 0 || searching) && (
        <Group gap={4}>
          {pills.map((pill) => (
            <Pill key={pill.key} size="sm" withRemoveButton onRemove={pill.onRemove}>
              {pill.label}
            </Pill>
          ))}
          <Text fz="xs" c="dimmed" px={2}>
            {listed.length} of {items.length}
          </Text>
          {pills.length > 1 && (
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={() => {
                setFilters(NO_FILTERS);
                setSort("name");
              }}
            >
              Clear
            </Button>
          )}
        </Group>
      )}
      <Box
        data-items-list
        tabIndex={0}
        role="listbox"
        aria-label="Items"
        aria-activedescendant={active < 0 ? undefined : `tak-item-row-${active}`}
        onKeyDown={onListKey}
        onBlur={(e) => e.target === e.currentTarget && setActiveKey(undefined)}
        style={{ flex: 1, minHeight: 0, display: "flex", outline: "none" }}
      >
        <ScrollArea style={{ flex: 1 }} offsetScrollbars viewportRef={setViewport}>
          {rows.length === 0 ? (
            <Box py="md">
              {items.length === 0 ? (
                <Placeholder
                  title="Nothing on the TAK picture yet"
                  detail="Items appear here as TAK users report in and markers are placed."
                />
              ) : (
                <Placeholder
                  title="No items match"
                  detail={
                    filters.inView
                      ? "Nothing listed is inside the map view: move the map or turn off In view."
                      : "Change or clear the search and filters."
                  }
                />
              )}
            </Box>
          ) : (
            viewport && (
              <Virtuoso
                ref={list}
                customScrollParent={viewport}
                data={rows}
                computeItemKey={(_, row) => row.key}
                itemContent={(index, row) => (
                  <div
                    id={`tak-item-row-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={row.kind === "item" && row.item.uid === selectedUid}
                    className="tak-group"
                    data-hidden={row.dimmed || undefined}
                    data-active={index === active || undefined}
                    style={{ paddingLeft: row.depth * 10 }}
                  >
                    {renderRow(row)}
                  </div>
                )}
              />
            )
          )}
        </ScrollArea>
      </Box>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconDownload size={14} />}
        disabled={shown.length === 0}
        title="The items listed, without hidden groups"
        onClick={() => download(kmlBlob("TAK overlays", shown), "tak-overlays.kml")}
      >
        Export {shown.length} as KML
      </Button>
    </Stack>
  );
};
