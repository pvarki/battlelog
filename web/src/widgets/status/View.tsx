import { ActionIcon, Badge, ColorSwatch, Group, Menu, Stack, Text, Tooltip } from "@mantine/core";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useEventDocument } from "../../dashboard/useEventDocument.ts";
import { buildStatusTree, flattenTree } from "./tree.ts";
import type { StatusConfig, StatusRow, StatusValues } from "./widget.ts";

const parseValues = (data: unknown): StatusValues => {
  const values = (data as { values?: unknown } | null)?.values;
  return { values: values && typeof values === "object" ? (values as StatusValues["values"]) : {} };
};

const StatusView = ({ config, updateConfig }: WidgetViewProps<StatusConfig>) => {
  const { value, update, status } = useEventDocument<StatusValues>({
    eventId: config.eventId,
    eventType: "status",
    headerFor: () => config.title?.trim() || "Status board",
    empty: { values: {} },
    parse: parseValues,
    onEventIdCaptured: (id) => updateConfig({ ...config, eventId: id }),
    // Chip clicks are discrete actions — save promptly, coalescing bursts.
    debounceMs: 400,
  });

  // ponytail: whole-object last-writer-wins — two screens editing different
  // rows within the same save window can drop each other's field (SSE
  // catch-up self-heals on the next update). Per-row events or server-side
  // jsonb merge if boards get busy.
  const setRowValue = (rowId: string, next: string | number) => {
    update({ values: { ...value.values, [rowId]: next } });
  };

  if (config.statuses.length === 0) {
    return (
      <Text c="dimmed" fz="sm" ta="center" mt="md">
        No statuses yet — configure them in Settings.
      </Text>
    );
  }

  return (
    <Stack gap={6} p="xs" h="100%" style={{ overflowY: "auto" }}>
      {flattenTree(buildStatusTree(config.statuses)).map((node) => {
        const row = node.row;
        return (
          <Group
            key={row?.id ?? node.path}
            justify="space-between"
            wrap="nowrap"
            pl={node.depth * 16}
          >
            <Tooltip
              label={row?.description}
              disabled={!row?.description?.trim()}
              openDelay={600}
              multiline
              maw={320}
              position="top-start"
            >
              <Text
                fz="sm"
                truncate
                fw={node.children.length > 0 ? 600 : undefined}
                style={row?.description?.trim() ? { cursor: "help" } : undefined}
              >
                {node.name}
              </Text>
            </Tooltip>
            {row &&
              (row.kind === "count" ? (
                <CountChip
                  count={Number(value.values[row.id] ?? 0)}
                  onChange={(n) => setRowValue(row.id, n)}
                />
              ) : (
                <ChoiceChip
                  row={row}
                  current={value.values[row.id]}
                  onChange={(v) => setRowValue(row.id, v)}
                />
              ))}
          </Group>
        );
      })}
      <Text c="dimmed" fz="xs" ta="right" mt="auto" mih="1.2em">
        {DOC_STATUS_LABEL[status]}
      </Text>
    </Stack>
  );
};

const ChoiceChip = ({
  row,
  current,
  onChange,
}: {
  row: StatusRow;
  current: string | number | undefined;
  onChange: (value: string) => void;
}) => {
  const selected = row.options.find((o) => o.value === current);
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <Badge
          color={selected?.color ?? "gray"}
          variant={selected ? "filled" : "outline"}
          style={{ cursor: "pointer" }}
        >
          {selected?.value ?? "—"}
        </Badge>
      </Menu.Target>
      <Menu.Dropdown>
        {row.options.length === 0 && <Menu.Item disabled>No options configured</Menu.Item>}
        {row.options.map((option) => (
          <Menu.Item
            key={option.value}
            leftSection={<ColorSwatch size={10} color={`var(--mantine-color-${option.color}-6)`} />}
            onClick={() => onChange(option.value)}
          >
            {option.value}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};

const CountChip = ({ count, onChange }: { count: number; onChange: (next: number) => void }) => (
  <Group gap={4} wrap="nowrap">
    <ActionIcon
      variant="subtle"
      color="gray"
      size="sm"
      aria-label="Decrement"
      onClick={() => onChange(count - 1)}
    >
      −
    </ActionIcon>
    <Badge color="blue" variant="light" miw={36}>
      {count}
    </Badge>
    <ActionIcon
      variant="subtle"
      color="gray"
      size="sm"
      aria-label="Increment"
      onClick={() => onChange(count + 1)}
    >
      +
    </ActionIcon>
  </Group>
);

export default StatusView;
