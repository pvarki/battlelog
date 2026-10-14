import { Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconLoader2, IconPlugConnectedX, IconPointFilled } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { useCallsign } from "./identity.ts";
import { type TakConnection, useTakStatus } from "./session.ts";

const LOOK = {
  live: { Icon: IconPointFilled, c: "success.4", label: "TAK live" },
  connecting: { Icon: IconLoader2, c: "warning.4", label: "TAK connecting" },
  down: { Icon: IconPlugConnectedX, c: "warning.4", label: "TAK disconnected" },
} as const;

/** TAK health and the user's callsign in the header, while a TAK view is open. */
export const TakIndicator = () => {
  const { connection, everConnected } = useTakStatus();
  const callsign = useCallsign();
  const previous = useRef<TakConnection>(connection);

  useEffect(() => {
    // A lost connection already shows on the map and in the status bar; only the return is news.
    if (connection === "live" && previous.current === "down" && everConnected) {
      notifications.show({ color: "teal", message: "TAK reconnected" });
    }
    previous.current = connection;
  }, [connection, everConnected]);

  if (connection === "idle") return null;
  const { Icon, c, label } = LOOK[connection];
  return (
    <Group gap={4} c={c} title={label} role="status" wrap="nowrap">
      <Icon size={16} stroke={1.5} />
      <Text fz="xs" fw={600} c="dark.0">
        {callsign ?? "TAK"}
      </Text>
      <Text fz="xs" visibleFrom="sm">
        {connection === "live" ? "" : label}
      </Text>
    </Group>
  );
};
