import { Button, Group, Text } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { useState } from "react";
import type { TakItem } from "../cot.ts";
import { download } from "../download.ts";
import { labelOf } from "../items.ts";
import { fetchHistory } from "../rest.ts";
import { DAY_MS } from "../store.ts";
import { historyTrack, trackToGpx, trackToKml } from "../track-export.ts";
import type { TrackPoint } from "../tracks.ts";

// ponytail: one request for the whole span; a fast reporter over a week is a large download.
const HISTORY_MS = 7 * DAY_MS;

const FORMATS = {
  gpx: {
    type: "application/gpx+xml",
    build: (item: TakItem, points: TrackPoint[]) => trackToGpx(labelOf(item), points),
  },
  kml: { type: "application/vnd.google-earth.kml+xml", build: trackToKml },
};

/** Downloads where the item has been over TAK's stored history of it. */
export const ExportTrack = ({ item }: { item: TakItem }) => {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const exportAs = async (format: keyof typeof FORMATS) => {
    setBusy(true);
    setProblem(undefined);
    try {
      const points = historyTrack(await fetchHistory(item.uid, HISTORY_MS / 1000));
      if (points.length < 2) return setProblem("TAK has no movement stored for this item");
      const { type, build } = FORMATS[format];
      download(new Blob([build(item, points)], { type }), `${labelOf(item)} track.${format}`);
    } catch (err) {
      console.warn("TAK track export failed", err);
      setProblem("TAK's history couldn't be loaded");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Group gap="xs" grow>
        {(Object.keys(FORMATS) as (keyof typeof FORMATS)[]).map((format) => (
          <Button
            key={format}
            variant="default"
            size="xs"
            leftSection={<IconDownload size={14} />}
            loading={busy}
            onClick={() => void exportAs(format)}
          >
            Track {format.toUpperCase()}
          </Button>
        ))}
      </Group>
      {problem && (
        <Text fz="xs" c="warning.4" mt={4}>
          {problem}
        </Text>
      )}
    </div>
  );
};
