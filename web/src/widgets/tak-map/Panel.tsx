import {
  ActionIcon,
  Badge,
  Box,
  Group,
  ScrollArea,
  Stack,
  Table,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import type { TakFeature } from "../../api.ts";
import { formatDateTime } from "../../time.ts";
import {
  anchorOf,
  contactsOf,
  formatMgrs,
  hasPosition,
  layerOf,
  type Status,
  statusOf,
  teamColor,
} from "./symbols.ts";
import { LAYER_LABEL } from "./widget.ts";

const STATUS_COLOR: Record<Status, string> = { online: "green", stale: "yellow", offline: "gray" };

const ago = (iso: string, now: number): string => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return formatDateTime(iso);
};

const Details = ({ f, now, onClose }: { f: TakFeature; now: number; onClose: () => void }) => {
  const p = f.properties;
  const layer = layerOf(f);
  const at = anchorOf(f);
  const rows: [string, string | undefined][] = [
    ["Type", `${LAYER_LABEL[layer]} · ${p.cotType}`],
    ["Team", [p.team, p.role].filter(Boolean).join(" · ") || undefined],
    ["Position", hasPosition(f) ? formatMgrs(at) : "No position (no GPS fix)"],
    ["Lat, lon", hasPosition(f) ? `${at[1].toFixed(5)}, ${at[0].toFixed(5)}` : undefined],
    ["Radius", p.radius ? `${Math.round(p.radius)} m` : undefined],
    ["Battery", p.battery !== undefined ? `${p.battery} %` : undefined],
    ["Device", p.device],
    ["Updated", `${formatDateTime(p.time)} (${ago(p.time, now)})`],
    ["Stale at", formatDateTime(p.stale)],
    ["Checkpoints", p.checkpoints?.map((c) => c.name).join(" → ")],
  ];
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600} truncate>
          {p.callsign ?? f.id}
        </Text>
        <ActionIcon variant="subtle" size="sm" onClick={onClose} aria-label="Close details">
          <IconX size={14} />
        </ActionIcon>
      </Group>
      {layer === "contacts" && (
        <Badge color={STATUS_COLOR[statusOf(f, now)]} variant="light" w="fit-content">
          {statusOf(f, now)}
        </Badge>
      )}
      <Table fz="xs" verticalSpacing={2} withRowBorders={false}>
        <Table.Tbody>
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td c="dimmed" w={80} style={{ verticalAlign: "top" }}>
                  {k}
                </Table.Td>
                <Table.Td>{v}</Table.Td>
              </Table.Tr>
            ))}
        </Table.Tbody>
      </Table>
      {p.remarks && (
        <Text fz="xs" style={{ whiteSpace: "pre-wrap" }}>
          {p.remarks}
        </Text>
      )}
    </Stack>
  );
};

const Contacts = ({
  items,
  now,
  onSelect,
}: {
  items: TakFeature[];
  now: number;
  onSelect: (id: string) => void;
}) => {
  const contacts = contactsOf(items, now);
  return (
    <Stack gap={4}>
      <Text fz="xs" fw={600} c="dimmed" tt="uppercase">
        TAK users ({contacts.filter((c) => statusOf(c, now) === "online").length}/{contacts.length}{" "}
        online)
      </Text>
      {contacts.length === 0 && (
        <Text fz="xs" c="dimmed">
          No TAK users seen yet.
        </Text>
      )}
      {contacts.map((c) => {
        const status = statusOf(c, now);
        return (
          <UnstyledButton key={c.id} onClick={() => onSelect(c.id)} py={2}>
            <Group gap={8} wrap="nowrap" opacity={status === "online" ? 1 : 0.6}>
              <Box
                w={10}
                h={10}
                style={{
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: teamColor(c.properties.team),
                }}
              />
              <Box style={{ minWidth: 0 }}>
                <Text fz="sm" truncate>
                  {c.properties.callsign ?? c.id}
                </Text>
                <Text fz="xs" c="dimmed" truncate>
                  {status === "online"
                    ? (c.properties.role ?? "online")
                    : `${status} · ${ago(c.properties.time, now)}`}
                  {!hasPosition(c) && " · no position"}
                </Text>
              </Box>
            </Group>
          </UnstyledButton>
        );
      })}
    </Stack>
  );
};

/** Side panel: TAK users, or details of the item picked on the map. */
export const Panel = ({
  items,
  selected,
  now,
  onSelect,
}: {
  items: TakFeature[];
  selected: TakFeature | undefined;
  now: number;
  onSelect: (id: string | null) => void;
}) => (
  <ScrollArea h="100%" p="xs" type="auto">
    {selected ? (
      <Details f={selected} now={now} onClose={() => onSelect(null)} />
    ) : (
      <Contacts items={items} now={now} onSelect={onSelect} />
    )}
  </ScrollArea>
);
