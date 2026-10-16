import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  ScrollArea,
  Stack,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconSearch,
} from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Placeholder } from "../../components/Placeholder.tsx";
import { useStoredSetting } from "../../stored-setting.ts";
import { useNow } from "../../use-now.ts";
import type { Position, TakItem } from "../cot.ts";
import { download } from "../download.ts";
import { teamColor } from "../items.ts";
import { useMapView } from "../map/camera.ts";
import { groupOf, groupTree, isHidden } from "../overlays.ts";
import { PanelActions, PanelFooter, PanelMenu, ViewOption } from "../panel.tsx";
import { kmlBlob } from "../plans/overlay-files.ts";
import { FilterPills, FiltersMenu, SortMenu, useItemListSettings } from "./FilterControls.tsx";
import { ItemRow } from "./ItemRow.tsx";
import { filterSources, matchesFilters } from "./item-filters.ts";
import {
  ancestorKeys,
  groupKeys,
  isGroupOpen,
  listRows,
  matchesQuery,
  type Row,
} from "./items-list.ts";

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
  const { filters, setFilters, sort, setSort } = useItemListSettings();
  /** Groups the user opened or closed; the rest follow the BIG_GROUP rule. */
  const [groupOpen, setGroupOpen] = useStoredSetting<Record<string, boolean>>({
    key: "battlelog.tak.items.groupsOpen",
    defaultValue: {},
  });
  const [compact, setCompact] = useStoredSetting({
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
    (i) => matchesQuery(i, query) && matchesFilters(i, filters, { now, view: view?.bounds, feeds }),
  );
  const rows = listRows(listed, {
    sort,
    from,
    hidden,
    isOpen: (group) => isGroupOpen(group, groupOpen, searching),
  });
  const shown = listed.filter((i) => !isHidden(groupOf(i), hidden));
  const sources = filterSources(items, feeds);
  const active = activeKey === undefined ? -1 : rows.findIndex((r) => r.key === activeKey);

  const setOpen = (key: string, open: boolean) =>
    setGroupOpen((current) => ({ ...current, [key]: open }));
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
    const closed = ancestorKeys(item).filter((k) => !groupOpen[k]);
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
        <PanelMenu>
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
        </PanelMenu>
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
            <SortMenu sort={sort} setSort={setSort} />
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
      <FilterPills
        filters={filters}
        setFilters={setFilters}
        sort={sort}
        setSort={setSort}
        sources={sources}
        fromOwnPosition={!!ownPosition}
        searching={searching}
        listedCount={listed.length}
        totalCount={items.length}
      />
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
        <ScrollArea style={{ flex: 1 }} offsetScrollbars="present" viewportRef={setViewport}>
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
                    data-depth={row.depth || undefined}
                    style={{ paddingLeft: row.depth * 14, "--depth": row.depth } as CSSProperties}
                  >
                    {renderRow(row)}
                  </div>
                )}
              />
            )
          )}
        </ScrollArea>
      </Box>
      <PanelFooter>
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
      </PanelFooter>
    </Stack>
  );
};
