import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { IconUrgent } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { formatAge } from "../../time.ts";
import type { TakItem } from "../cot.ts";
import { activeEmergencies } from "../items.ts";
import { useNow } from "../use-now.ts";
import { useEmergencyPulse } from "./useEmergencyPulse.ts";

const AGE_REFRESH_MS = 10_000;

/** Active ATAK emergencies: a banner over the map listing them and a pulse on the map at each. */
export const EmergencyBanner = ({
  items,
  map,
  onCenter,
}: {
  items: TakItem[];
  map: MapLibreMap | undefined;
  /** Absent on a map nobody clicks, like a wall screen. */
  onCenter?: (item: TakItem) => void;
}) => {
  const now = useNow(AGE_REFRESH_MS);
  const emergencies = activeEmergencies(items, now);
  useEmergencyPulse(map, emergencies);
  if (emergencies.length === 0) return null;
  return (
    <Alert
      color="red"
      variant="filled"
      icon={<IconUrgent size={20} />}
      title={emergencies.length > 1 ? `${emergencies.length} emergencies` : "Emergency"}
      role="alert"
    >
      <Stack gap={4}>
        {emergencies.map((item) => (
          <Group key={item.uid} justify="space-between" wrap="nowrap" gap="xs">
            <Text fz="sm" fw={600} truncate>
              {item.emergency?.from} · {item.emergency?.kind}{" "}
              <Text span fz="xs" fw={400} className="tak-mono">
                {formatAge(now - item.time)} ago
              </Text>
            </Text>
            {onCenter && (
              <Button size="compact-xs" variant="white" color="red" onClick={() => onCenter(item)}>
                Center
              </Button>
            )}
          </Group>
        ))}
      </Stack>
    </Alert>
  );
};
