import {
  ActionIcon,
  Badge,
  Box,
  Checkbox,
  Group,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  IconChevronDown,
  IconChevronRight,
  IconCurrentLocation,
  IconCurrentLocationOff,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import type { TakFeature, TakMission } from "../../api.ts";
import { formatDateTime } from "../../time.ts";
import {
  anchorOf,
  contactsOf,
  describeType,
  formatMgrs,
  hasPosition,
  layerOf,
  MISSION_PROBLEM_TEXT,
  type MissionProblem,
  missionShown,
  type Status,
  shortDevice,
  statusOf,
  teamColor,
} from "./symbols.ts";
import type { TakMapConfig } from "./widget.ts";

const STATUS_COLOR: Record<Status, string> = { online: "green", stale: "yellow", offline: "gray" };

const ago = (iso: string, now: number): string => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
};

const Details = ({
  f,
  now,
  following,
  onToggleFollow,
  onClose,
}: {
  f: TakFeature;
  now: number;
  /** Undefined for items that can't be followed (mission contents). */
  following: boolean | undefined;
  onToggleFollow: () => void;
  onClose: () => void;
}) => {
  const p = f.properties;
  const layer = layerOf(f);
  const at = anchorOf(f);
  const rows: [string, string | undefined][] = [
    ["Team", [p.team, p.role].filter(Boolean).join(" · ") || undefined],
    ["Position", hasPosition(f) ? formatMgrs(at) : "No position (no GPS fix)"],
    ["Lat, lon", hasPosition(f) ? `${at[1].toFixed(5)}, ${at[0].toFixed(5)}` : undefined],
    ["Radius", p.radius ? `${Math.round(p.radius)} m` : undefined],
    ["Battery", p.battery !== undefined ? `${p.battery} %` : undefined],
    ["Device", p.device && shortDevice(p.device)],
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
        <Group gap={2} wrap="nowrap">
          {following !== undefined && (
            <ActionIcon
              variant={following ? "filled" : "subtle"}
              size="sm"
              onClick={onToggleFollow}
              aria-label={following ? "Stop following" : "Keep the map on this item"}
              title={following ? "Stop following" : "Keep the map on this item"}
            >
              {following ? <IconCurrentLocationOff size={14} /> : <IconCurrentLocation size={14} />}
            </ActionIcon>
          )}
          <ActionIcon variant="subtle" size="sm" onClick={onClose} aria-label="Close details">
            <IconX size={14} />
          </ActionIcon>
        </Group>
      </Group>
      <Group gap={6}>
        <Text fz="sm">{describeType(f)}</Text>
        {layer === "contacts" && (
          <Badge color={STATUS_COLOR[statusOf(f, now)]} variant="light">
            {statusOf(f, now)}
          </Badge>
        )}
      </Group>
      <Table fz="xs" verticalSpacing={2} withRowBorders={false}>
        <Table.Tbody>
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td c="dimmed" w={80} style={{ verticalAlign: "top" }}>
                  {k}
                </Table.Td>
                <Table.Td style={{ overflowWrap: "anywhere" }}>{v}</Table.Td>
              </Table.Tr>
            ))}
        </Table.Tbody>
      </Table>
      <Text fz="xs" c="dimmed" ff="monospace">
        CoT {p.cotType}
      </Text>
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

const MissionProblemRow = ({
  problem,
  shown,
  onToggle,
}: {
  problem: MissionProblem;
  shown: boolean;
  onToggle: () => void;
}) => (
  <Group gap={6} wrap="nowrap" align="flex-start">
    <Checkbox
      size="xs"
      mt={3}
      checked={shown}
      onChange={onToggle}
      aria-label={`Show ${problem.name} on the map`}
    />
    <Box style={{ flex: 1, minWidth: 0 }}>
      <Group gap={4} wrap="nowrap">
        <Text fz="sm" fw={500} truncate>
          {problem.name}
        </Text>
        <Badge size="xs" color="warning" variant="light" ml="auto">
          {MISSION_PROBLEM_TEXT[problem.reason].label}
        </Badge>
      </Group>
      <Text fz="xs" c="dimmed">
        {MISSION_PROBLEM_TEXT[problem.reason].detail}
      </Text>
    </Box>
  </Group>
);

const Missions = ({
  missions,
  config,
  problems,
  onToggle,
  onSelect,
}: {
  missions: TakMission[];
  config: TakMapConfig;
  problems: MissionProblem[];
  onToggle: (name: string) => void;
  onSelect: (id: string) => void;
}) => {
  const [open, setOpen] = useState<string | null>(null);
  const problemOf = (name: string) => problems.find((p) => p.name === name);
  const notFound = problems.filter((p) => p.reason === "not-found");
  if (missions.length === 0 && notFound.length === 0) {
    return (
      <Text fz="xs" c="dimmed">
        No missions on this TAK Server.
      </Text>
    );
  }
  return (
    <Stack gap="xs">
      {notFound.map((p) => (
        <MissionProblemRow
          key={p.name}
          problem={p}
          shown={missionShown(config, p.name)}
          onToggle={() => onToggle(p.name)}
        />
      ))}
      {missions.map((m) => {
        const problem = problemOf(m.name);
        if (problem) {
          return (
            <MissionProblemRow
              key={m.name}
              problem={problem}
              shown={missionShown(config, m.name)}
              onToggle={() => onToggle(m.name)}
            />
          );
        }
        const expanded = open === m.name;
        return (
          <Box key={m.name}>
            <Group gap={6} wrap="nowrap" align="flex-start">
              <Checkbox
                size="xs"
                mt={3}
                checked={missionShown(config, m.name)}
                onChange={() => onToggle(m.name)}
                aria-label={`Show ${m.name} on the map`}
              />
              <UnstyledButton
                onClick={() => setOpen(expanded ? null : m.name)}
                style={{ flex: 1, minWidth: 0 }}
              >
                <Group gap={4} wrap="nowrap">
                  {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                  <Text fz="sm" fw={500} truncate>
                    {m.name}
                  </Text>
                  <Badge size="xs" variant="light" ml="auto">
                    {m.items.length}
                  </Badge>
                </Group>
                {m.description && (
                  <Text fz="xs" c="dimmed" lineClamp={2}>
                    {m.description}
                  </Text>
                )}
              </UnstyledButton>
            </Group>
            {expanded && (
              <Stack gap={0} pl={28} mt={4}>
                {m.items.map((f) => (
                  <UnstyledButton key={f.id} onClick={() => onSelect(f.id)} py={1}>
                    <Text fz="xs" truncate>
                      {f.properties.callsign ?? f.id}{" "}
                      <Text span c="dimmed" fz="xs">
                        {describeType(f)}
                      </Text>
                    </Text>
                  </UnstyledButton>
                ))}
              </Stack>
            )}
          </Box>
        );
      })}
    </Stack>
  );
};

export type PanelTab = "users" | "missions";

/** Side panel: TAK users and missions, or details of the item picked on the map. */
export const Panel = ({
  items,
  missions,
  config,
  problems,
  tab,
  onTabChange,
  onToggleMission,
  onToggleFollow,
  selected,
  now,
  onSelect,
}: {
  items: TakFeature[];
  missions: TakMission[];
  config: TakMapConfig;
  problems: MissionProblem[];
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  onToggleMission: (name: string) => void;
  onToggleFollow: (id: string) => void;
  selected: TakFeature | undefined;
  now: number;
  onSelect: (id: string | null) => void;
}) =>
  selected ? (
    <ScrollArea h="100%" p="xs" type="auto" scrollbars="y">
      <Details
        f={selected}
        now={now}
        following={items.includes(selected) ? config.followId === selected.id : undefined}
        onToggleFollow={() => onToggleFollow(selected.id)}
        onClose={() => onSelect(null)}
      />
    </ScrollArea>
  ) : (
    <Tabs
      value={tab}
      onChange={(value) => value && onTabChange(value as PanelTab)}
      h="100%"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <Tabs.List grow>
        <Tabs.Tab value="users" fz="xs">
          Users
        </Tabs.Tab>
        <Tabs.Tab
          value="missions"
          fz="xs"
          rightSection={
            problems.length > 0 && (
              <Badge size="xs" color="warning" circle aria-label="Some missions not available">
                !
              </Badge>
            )
          }
        >
          Missions ({missions.length})
        </Tabs.Tab>
      </Tabs.List>
      <ScrollArea style={{ flex: 1 }} p="xs" type="auto" scrollbars="y">
        <Tabs.Panel value="users">
          <Contacts items={items} now={now} onSelect={onSelect} />
        </Tabs.Panel>
        <Tabs.Panel value="missions">
          <Missions
            missions={missions}
            config={config}
            problems={problems}
            onToggle={onToggleMission}
            onSelect={onSelect}
          />
        </Tabs.Panel>
      </ScrollArea>
    </Tabs>
  );
