import { Group, Text } from "@mantine/core";
import { IconCloudOff } from "@tabler/icons-react";

/**
 * Rendered above event rows whenever the initial fetch failed but the list is
 * non-empty (cached fallback or live-stream arrivals). The header dot tracks
 * only the SSE stream, so without this a failed history fetch would show
 * last-known rows pixel-identical to live ones.
 */
export const StaleNotice = () => (
  <Group gap={6} px="xs" py={2} c="warning.4" wrap="nowrap">
    <IconCloudOff size={14} stroke={1.5} />
    <Text fz="xs">Couldn't refresh — showing last known events</Text>
  </Group>
);
