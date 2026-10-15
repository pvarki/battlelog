import { Button, Group, Text } from "@mantine/core";
import { IconCloudOff } from "@tabler/icons-react";
import type { ReactNode } from "react";

/**
 * Rendered above event rows whenever the initial fetch failed but the list is
 * non-empty (cached fallback or live-stream arrivals). The header dot tracks
 * only the SSE stream, so without this a failed history fetch would show
 * last-known rows pixel-identical to live ones.
 */
export const StaleNotice = ({
  children = "Couldn't refresh — showing last known events",
  onRetry,
}: {
  children?: ReactNode;
  onRetry?: () => void;
}) => (
  <Group gap={6} px="xs" py={2} c="warning.4" wrap="nowrap">
    <IconCloudOff size={14} />
    <Text fz="xs" style={{ flex: 1 }}>
      {children}
    </Text>
    {onRetry && (
      <Button size="compact-xs" variant="subtle" color="warning" onClick={onRetry}>
        Retry
      </Button>
    )}
  </Group>
);
