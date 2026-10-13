import { Group, Text } from "@mantine/core";
import { type CoordFormat, formatCoord } from "./coords.ts";
import type { Position } from "./cot.ts";
import { formatAge } from "./items.ts";
import type { TakStatus } from "./session.ts";
import { useNow } from "./use-now.ts";

type Props = {
  status: TakStatus;
  callsign: string | null | undefined;
  cursor: Position | undefined;
  coordFormat: CoordFormat;
  itemCount: number;
};

export const CONNECTION_TEXT = {
  idle: "TAK idle",
  connecting: "Connecting to TAK…",
  live: "TAK live",
  down: "TAK disconnected",
};

/** The freshness line operators glance at: where the cursor is, and how current the picture is. */
export const StatusBar = ({ status, callsign, cursor, coordFormat, itemCount }: Props) => {
  const now = useNow(1000);

  return (
    <Group className="tak-statusbar" gap="lg" wrap="nowrap" role="status">
      <Text fz="xs" className="tak-mono" miw={190}>
        {cursor ? formatCoord(cursor, coordFormat) : "—"}
      </Text>
      <Text fz="xs" c={status.connection === "live" ? undefined : "warning.4"}>
        {CONNECTION_TEXT[status.connection]}
        {status.lastMessageAt ? ` · last message ${formatAge(now - status.lastMessageAt)} ago` : ""}
      </Text>
      {status.backfillDaysLeft > 0 && (
        <Text fz="xs" c="dimmed">
          Loading history… {status.backfillDaysLeft} d left
        </Text>
      )}
      <Text fz="xs" c="dimmed">
        {itemCount} items
      </Text>
      <Text fz="xs" ml="auto" c={callsign ? undefined : "warning.4"}>
        {callsign === undefined
          ? ""
          : callsign
            ? `Signed in as ${callsign}`
            : "No callsign — changes to TAK are disabled"}
      </Text>
    </Group>
  );
};
