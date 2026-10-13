import { Badge, Group, ScrollArea, Stack, Text, TextInput, UnstyledButton } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useState } from "react";
import type { TakItem } from "../cot.ts";
import {
  CATEGORIES,
  type Category,
  categoryOf,
  describeType,
  formatAge,
  labelOf,
  STATUS_LABEL,
  statusOf,
  teamColor,
} from "../items.ts";
import { useNow } from "../use-now.ts";

type Props = {
  items: TakItem[];
  selectedUid: string | undefined;
  onPick: (item: TakItem) => void;
};

const matches = (item: TakItem, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [labelOf(item), item.team, describeType(item), item.uid].some((s) =>
    s?.toLowerCase().includes(q),
  );
};

const byName = (a: TakItem, b: TakItem) =>
  (a.team ?? "").localeCompare(b.team ?? "") || labelOf(a).localeCompare(labelOf(b));

const Row = ({
  item,
  selected,
  now,
  onPick,
}: {
  item: TakItem;
  selected: boolean;
  now: number;
  onPick: () => void;
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
          {status !== "online" && (
            <Badge size="xs" variant="outline" color={status === "offline" ? "gray" : "warning"}>
              {STATUS_LABEL[status]}
            </Badge>
          )}
        </Stack>
      </Group>
    </UnstyledButton>
  );
};

/** Every item, grouped by category: the keyboard route to anything on the map. */
export const ItemsDrawer = ({ items, selectedUid, onPick }: Props) => {
  const [query, setQuery] = useState("");
  const now = useNow(10_000);
  const visible = items.filter((i) => matches(i, query));
  const groups = (Object.keys(CATEGORIES) as Category[])
    .map((category) => ({
      category,
      items: visible.filter((i) => categoryOf(i) === category).sort(byName),
    }))
    .filter((g) => g.items.length > 0);

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
          <Text fz="sm" c="dimmed" p="xs">
            {items.length === 0
              ? "Nothing on the TAK picture yet. Items appear here as TAK users report in and markers are placed."
              : "No items match the filter."}
          </Text>
        ) : (
          groups.map(({ category, items: rows }) => (
            <section key={category} aria-label={CATEGORIES[category]}>
              <Text className="tak-group-heading">
                {CATEGORIES[category]} <span>{rows.length}</span>
              </Text>
              {rows.map((item) => (
                <Row
                  key={item.uid}
                  item={item}
                  now={now}
                  selected={item.uid === selectedUid}
                  onPick={() => onPick(item)}
                />
              ))}
            </section>
          ))
        )}
      </ScrollArea>
    </Stack>
  );
};
