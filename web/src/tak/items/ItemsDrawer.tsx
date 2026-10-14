import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  ScrollArea,
  Stack,
  Text,
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
import { type MouseEvent, type ReactNode, useState } from "react";
import { Placeholder } from "../../components/Placeholder.tsx";
import { formatAge } from "../../time.ts";
import { useNow } from "../../use-now.ts";
import type { TakItem } from "../cot.ts";
import { download } from "../download.ts";
import {
  describeType,
  type ItemStatus,
  labelOf,
  STATUS_LABEL,
  statusOf,
  teamColor,
} from "../items.ts";
import { groupOf, groupTree, isHidden, type Group as OverlayGroup } from "../overlays.ts";
import { kmlBlob } from "../plans/overlay-files.ts";

type Props = {
  items: TakItem[];
  selectedUid: string | undefined;
  onPick: (item: TakItem) => void;
  /** Items picked together with Shift-click, to move or delete as a group. */
  grouped?: ReadonlySet<string>;
  onToggleGrouped?: (item: TakItem) => void;
  hidden: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
};

const matches = (item: TakItem, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [labelOf(item), item.team, describeType(item), item.uid].some((s) =>
    s?.toLowerCase().includes(q),
  );
};

const byName = (a: TakItem, b: TakItem) =>
  (a.team ?? "").localeCompare(b.team ?? "") ||
  labelOf(a).localeCompare(labelOf(b), undefined, { numeric: true });

/** Stale or disconnected; nothing while online. */
export const StatusBadge = ({ status }: { status: ItemStatus }) =>
  status === "online" ? null : (
    <Badge
      size="xs"
      variant="outline"
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
  onPick,
}: {
  item: TakItem;
  selected: boolean;
  now: number;
  onPick: (event: MouseEvent) => void;
}) => {
  const status = statusOf(item, now);
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
          <Text fz="sm" fw={600} truncate>
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
          <Text fz="xs" c="dimmed">
            {formatAge(now - item.time)}
          </Text>
          <StatusBadge status={status} />
        </Stack>
      </Group>
    </UnstyledButton>
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
}: Props) => {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const now = useNow(10_000);
  const filtering = query.trim() !== "";
  const listed = items.filter((i) => matches(i, query));
  const groups = groupTree(listed);
  const shown = listed.filter((i) => !isHidden(groupOf(i), hidden));

  const toggleCollapsed = (key: string) =>
    setCollapsed((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const renderGroup = (group: OverlayGroup, parentHidden: boolean): ReactNode => {
    const ownHidden = hidden.has(group.key);
    const open = filtering || !collapsed.has(group.key);
    return (
      <section
        key={group.key}
        className="tak-group"
        aria-label={group.label}
        data-hidden={(ownHidden && !parentHidden) || undefined}
      >
        <div className="tak-group-header">
          <UnstyledButton
            className="tak-group-toggle"
            aria-expanded={open}
            disabled={filtering}
            onClick={() => toggleCollapsed(group.key)}
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
            size="md"
            aria-label={`Show ${group.label} on the map`}
            aria-pressed={!ownHidden}
            title={ownHidden ? "Not on the map" : "Shown on the map"}
            onClick={() => onToggleGroup(group.key)}
          >
            {ownHidden ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </ActionIcon>
        </div>
        {open && (
          <div className="tak-group-body">
            {group.children.map((child) => renderGroup(child, ownHidden || parentHidden))}
            {group.items.sort(byName).map((item) => (
              <ItemRow
                key={item.uid}
                item={item}
                now={now}
                selected={item.uid === selectedUid || !!grouped?.has(item.uid)}
                onPick={(e) => (e.shiftKey && onToggleGrouped ? onToggleGrouped : onPick)(item)}
              />
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <Stack gap="xs" h="100%">
      <TextInput
        size="xs"
        placeholder="Filter by name, team or type"
        aria-label="Filter items"
        leftSection={<IconSearch size={14} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        {groups.length === 0 ? (
          <Box py="md">
            {items.length === 0 ? (
              <Placeholder
                title="Nothing on the TAK picture yet"
                detail="Items appear here as TAK users report in and markers are placed."
              />
            ) : (
              <Placeholder title="No items match the filter" detail="Change or clear the filter." />
            )}
          </Box>
        ) : (
          groups.map((group) => renderGroup(group, false))
        )}
      </ScrollArea>
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
