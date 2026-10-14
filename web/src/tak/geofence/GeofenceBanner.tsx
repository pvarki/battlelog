import { Alert, Button, CloseButton, Group, Stack, Text } from "@mantine/core";
import { IconFence } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { formatAge } from "../../time.ts";
import { useNow } from "../../use-now.ts";
import type { TakItem } from "../cot.ts";
import { activeBreachAlerts } from "../items.ts";
import { describeCrossing } from "./geofence.ts";
import type { FenceAlert } from "./useGeofenceAlerts.ts";

const AGE_REFRESH_MS = 10_000;

const Row = ({
  text,
  time,
  now,
  onShow,
  onDismiss,
  children,
}: {
  text: string;
  time: number;
  now: number;
  onShow: () => void;
  onDismiss: () => void;
  children?: ReactNode;
}) => (
  <Group justify="space-between" wrap="nowrap" gap="xs">
    <Text fz="sm" truncate>
      {text}{" "}
      <Text span fz="xs" c="dimmed" className="tak-mono">
        {formatAge(now - time)} ago
      </Text>
    </Text>
    <Group gap={4} wrap="nowrap">
      <Button size="compact-xs" variant="default" onClick={onShow}>
        Show
      </Button>
      {children}
      <CloseButton size="sm" onClick={onDismiss} aria-label="Dismiss" />
    </Group>
  </Group>
);

/** Geofence crossings seen here and breach alerts from other TAK clients: a warning, not an emergency. */
export const GeofenceBanner = ({
  alerts,
  items,
  isDismissed,
  onShow,
  onDismiss,
  onDismissReceived,
  onSend,
  sendReason,
}: {
  alerts: FenceAlert[];
  /** The live picture, which carries the alerts other TAK clients sent. */
  items: TakItem[];
  isDismissed: (item: TakItem) => boolean;
  onShow: (uid: string) => void;
  onDismiss: (id: string) => void;
  onDismissReceived: (item: TakItem) => void;
  onSend: (alert: FenceAlert) => void;
  /** Why a breach alert can't be sent to TAK, or undefined when it can. */
  sendReason: string | undefined;
}) => {
  const now = useNow(AGE_REFRESH_MS);
  const received = activeBreachAlerts(items, now).filter((i) => !isDismissed(i));
  if (alerts.length === 0 && received.length === 0) return null;
  return (
    <Alert color="warning" variant="outline" icon={<IconFence size={18} />} title="Geofence">
      <Stack gap={4}>
        {alerts.map((alert) => (
          <Row
            key={alert.id}
            text={describeCrossing(alert)}
            time={alert.time}
            now={now}
            onShow={() => onShow(alert.item.uid)}
            onDismiss={() => onDismiss(alert.id)}
          >
            <Button
              size="compact-xs"
              variant="default"
              disabled={!!sendReason}
              title={sendReason ?? "Send a geofence breach alert to everyone on TAK"}
              onClick={() => onSend(alert)}
            >
              Alert TAK
            </Button>
          </Row>
        ))}
        {received.map((item) => (
          <Row
            key={`${item.uid} ${item.time}`}
            text={`${item.emergency?.from} · ${item.emergency?.kind}${item.creator ? ` (from ${item.creator})` : ""}`}
            time={item.time}
            now={now}
            onShow={() => onShow(item.uid)}
            onDismiss={() => onDismissReceived(item)}
          />
        ))}
      </Stack>
    </Alert>
  );
};
