import { ActionIcon, Badge, Group, ScrollArea, Stack, Text, TextInput } from "@mantine/core";
import { IconFocusCentered, IconMessage, IconSearch } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { type ReactNode, useEffect, useState } from "react";
import type { Position, TakItem } from "../cot.ts";
import { formatBearing } from "../drawing/measure.ts";
import { bearing, distance } from "../geo.ts";
import {
  anchorOf,
  formatAge,
  hasPosition,
  type ItemStatus,
  STATUS_LABEL,
  shortDevice,
  statusOf,
  teamColor,
} from "../items.ts";
import { formatDistance } from "../map/layers.ts";
import { useNow } from "../use-now.ts";

type Props = {
  /** TAK users other than this one. */
  contacts: TakItem[];
  map: MapLibreMap | undefined;
  /** Distances are measured from here when known, else from the map centre. */
  ownPosition: Position | undefined;
  onCenter: (contact: TakItem) => void;
  onChat: (contact: TakItem) => void;
  /** This user's own position controls, above the list. */
  children?: ReactNode;
};

const STATUS_ORDER: Record<ItemStatus, number> = { online: 0, stale: 1, offline: 2 };

const matches = (contact: TakItem, query: string) => {
  const q = query.trim().toLowerCase();
  return (
    !q || [contact.callsign, contact.team, contact.role].some((s) => s?.toLowerCase().includes(q))
  );
};

const useMapCentre = (map: MapLibreMap | undefined) => {
  const [centre, setCentre] = useState<Position>();
  useEffect(() => {
    if (!map) return;
    const update = () => setCentre(map.getCenter().toArray());
    update();
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [map]);
  return centre;
};

const ContactRow = ({
  contact,
  now,
  from,
  onCenter,
  onChat,
}: {
  contact: TakItem;
  now: number;
  from: Position | undefined;
  onCenter: () => void;
  onChat: () => void;
}) => {
  const status = statusOf(contact, now);
  const at = hasPosition(contact) ? anchorOf(contact) : undefined;
  const details = [
    contact.role,
    contact.battery !== undefined && `${contact.battery} %`,
    contact.device && shortDevice(contact.device),
  ].filter(Boolean);
  return (
    <div className="tak-row" data-faded={status !== "online" || undefined}>
      <Group gap="xs" wrap="nowrap" justify="space-between">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text fz="sm" fw={600} truncate>
            {contact.callsign ?? contact.uid}
          </Text>
          <Text fz="xs" c="dimmed" truncate>
            {details.join(" · ")}
          </Text>
          <Text component="div" fz="xs" c="dimmed" truncate>
            {status === "online" ? (
              `seen ${formatAge(now - contact.time)} ago`
            ) : (
              <Badge size="xs" variant="outline" color={status === "offline" ? "gray" : "warning"}>
                {STATUS_LABEL[status]} · {formatAge(now - contact.time)}
              </Badge>
            )}
            {at && from && (
              <span className="tak-mono">
                {" · "}
                {formatDistance(distance(from, at))} · {formatBearing(bearing(from, at))}
              </span>
            )}
          </Text>
        </Stack>
        <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={`Centre on ${contact.callsign}`}
            disabled={!at}
            onClick={onCenter}
          >
            <IconFocusCentered size={16} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={`Chat with ${contact.callsign}`}
            onClick={onChat}
          >
            <IconMessage size={16} />
          </ActionIcon>
        </Group>
      </Group>
    </div>
  );
};

/** ATAK's Contacts: the TAK users on the picture by team, reachable ones first. */
export const ContactsDrawer = ({
  contacts,
  map,
  ownPosition,
  onCenter,
  onChat,
  children,
}: Props) => {
  const [query, setQuery] = useState("");
  const now = useNow(10_000);
  const centre = useMapCentre(map);
  const from = ownPosition ?? centre;
  const shown = contacts
    .filter((c) => matches(c, query))
    .sort(
      (a, b) =>
        STATUS_ORDER[statusOf(a, now)] - STATUS_ORDER[statusOf(b, now)] ||
        (a.callsign ?? "").localeCompare(b.callsign ?? ""),
    );
  const byTeam = new Map<string, TakItem[]>();
  for (const c of shown) byTeam.set(c.team ?? "", [...(byTeam.get(c.team ?? "") ?? []), c]);
  const teams = [...byTeam.keys()].sort();

  return (
    <Stack gap="xs" h="100%">
      {children}
      <TextInput
        size="xs"
        placeholder="Filter by callsign, team or role"
        aria-label="Filter contacts"
        leftSection={<IconSearch size={14} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <Text fz="xs" c="dimmed">
        Distances from {ownPosition ? "your position" : "the map centre"}
      </Text>
      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        {teams.length === 0 && (
          <Text fz="sm" c="dimmed" p="xs">
            {contacts.length === 0
              ? "No TAK users on the picture yet."
              : "No contacts match the filter."}
          </Text>
        )}
        {teams.map((team) => (
          <section key={team} className="tak-group" aria-label={team}>
            <Text fz="xs" fw={600} c="dimmed" px={6} pt={4}>
              <span className="tak-swatch" style={{ background: teamColor(team) }} />
              {team} <span className="tak-group-count">{byTeam.get(team)?.length}</span>
            </Text>
            {byTeam.get(team)?.map((contact) => (
              <ContactRow
                key={contact.uid}
                contact={contact}
                now={now}
                from={from}
                onCenter={() => onCenter(contact)}
                onChat={() => onChat(contact)}
              />
            ))}
          </section>
        ))}
      </ScrollArea>
    </Stack>
  );
};
