import { Button, Group, Progress, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDownload } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useRef, useState } from "react";
import type { MapSource } from "./basemaps.ts";
import { areaPlan, canSaveArea, saveArea } from "./offline-area.ts";

const DEFAULT_MAX_ZOOM = 19;

/** Saves the background map of what's on screen, for when the network is gone. */
export const SaveAreaSection = ({
  map,
  source,
}: {
  map: MapLibreMap | undefined;
  source: MapSource;
}) => {
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const abort = useRef<AbortController>(undefined);
  if (!map || !canSaveArea(source)) return null;

  const start = async () => {
    const b = map.getBounds();
    const plan = areaPlan(
      { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
      Math.floor(map.getZoom()),
      source.spec.maxzoom ?? DEFAULT_MAX_ZOOM,
    );
    if (plan.tiles.length === 0) {
      notifications.show({
        color: "yellow",
        message: "Zoom in further: this area is too large to save.",
      });
      return;
    }
    abort.current = new AbortController();
    setProgress({ done: 0, total: plan.tiles.length });
    const failed = await saveArea(
      source,
      plan.tiles,
      (done) => setProgress({ done, total: plan.tiles.length }),
      abort.current.signal,
    );
    const cancelled = abort.current.signal.aborted;
    setProgress(undefined);
    if (cancelled) return;
    notifications.show({
      color: failed ? "yellow" : "teal",
      message: `${source.label}: zoom ${plan.fromZoom}–${plan.toZoom} saved for offline use${failed ? `, ${failed} of ${plan.tiles.length} tiles failed` : ""}.`,
    });
  };

  return (
    <Stack gap={6}>
      <Text className="tak-group-heading">Offline</Text>
      <Text fz="xs" c="dimmed">
        Maps you look at are kept in this browser. Save the area on screen to have it, a few zoom
        levels deeper, without a network.
      </Text>
      {progress ? (
        <Group gap="xs" wrap="nowrap">
          <Progress value={(progress.done / progress.total) * 100} style={{ flex: 1 }} />
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            onClick={() => abort.current?.abort()}
          >
            Cancel
          </Button>
        </Group>
      ) : (
        <Button
          size="xs"
          variant="default"
          leftSection={<IconDownload size={14} />}
          onClick={() => void start()}
        >
          Save this area of {source.label}
        </Button>
      )}
    </Stack>
  );
};
