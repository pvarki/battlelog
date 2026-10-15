import { Group, Text } from "@mantine/core";
import { formatAge } from "../time.ts";
import { useNow } from "../use-now.ts";
import { type CoordFormat, formatCoord } from "./coords.ts";
import { type Cursor, useCursor } from "./map/cursor.ts";
import type { TakStatus } from "./session.ts";

type Props = {
  cursor: Cursor;
  status: TakStatus;
  callsign: string | null | undefined;
  coordFormat: CoordFormat;
  itemCount: number;
  /** Where changes go when not straight to TAK. */
  planName?: string;
};

export const CONNECTION_TEXT = {
  idle: "TAK idle",
  connecting: "Connecting to TAK…",
  live: "TAK live",
  down: "TAK disconnected",
};

/** The freshness line operators glance at: where the cursor is, and how current the picture is. */
export const StatusBar = ({
  status,
  callsign,
  cursor: pointer,
  coordFormat,
  itemCount,
  planName,
}: Props) => {
  const now = useNow(1000);
  const cursor = useCursor(pointer);

  return (
    <Group className="tak-statusbar" gap="md" wrap="nowrap" role="status">
      <Text fz="xs" c={status.connection === "live" ? undefined : "warning.4"}>
        {CONNECTION_TEXT[status.connection]}
        {status.lastMessageAt ? ` · last message ${formatAge(now - status.lastMessageAt)} ago` : ""}
      </Text>
      {status.backfillDaysLeft > 0 && (
        <Text fz="xs" c="dimmed">
          {status.savedThrough
            ? `Saved picture from ${formatAge(now - status.savedThrough)} ago · catching up…`
            : `Loading history… ${status.backfillDaysLeft} d left`}
        </Text>
      )}
      {status.historyFailed && (
        <Text fz="xs" c="warning.4">
          History incomplete · retried on reconnect
        </Text>
      )}
      <Text fz="xs" c="dimmed">
        {itemCount} items
      </Text>
      {/* Where a change goes, visible with the drawing tools closed too. */}
      <Text fz="xs" c={planName ? "accent.4" : "dimmed"} fw={planName ? 600 : undefined}>
        {planName ? `Changes go to plan ${planName}` : "Changes go to TAK"}
      </Text>
      {/* The header names the signed-in callsign; only its absence needs saying here. */}
      {callsign === "" && (
        <Text fz="xs" c="warning.4">
          No callsign: changes to TAK are disabled
        </Text>
      )}
      {cursor && (
        <Text fz="xs" className="tak-mono tak-cursor-readout" ml="auto" title="Under the pointer">
          {formatCoord(cursor, coordFormat)}
        </Text>
      )}
    </Group>
  );
};
