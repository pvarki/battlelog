import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  Slider,
  Text,
} from "@mantine/core";
import { IconHistory, IconPlayerPause, IconPlayerPlay, IconX } from "@tabler/icons-react";
import { DAY_MS } from "../store.ts";
import type { ReplayControls } from "./useReplay.ts";

const HOUR_MS = 60 * 60 * 1000;

const WINDOWS = [
  { value: String(HOUR_MS), label: "Last 1 h" },
  { value: String(2 * HOUR_MS), label: "Last 2 h" },
  { value: String(6 * HOUR_MS), label: "Last 6 h" },
  { value: String(12 * HOUR_MS), label: "Last 12 h" },
  { value: String(DAY_MS), label: "Last 24 h" },
  { value: String(3 * DAY_MS), label: "Last 3 days" },
  { value: String(7 * DAY_MS), label: "Last 7 days" },
];

const SPEEDS = ["1", "10", "60", "300"];

const formatMoment = (ms: number, withDate: boolean) =>
  new Date(ms).toLocaleString("fi-FI", {
    ...(withDate && { day: "numeric", month: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });

/** Shown over the map all through replay, so nobody takes the picture for live. */
export const ReplayBanner = ({ replay }: { replay: ReplayControls }) => (
  <Alert color="warning" variant="filled" icon={<IconHistory size={18} />}>
    <Text fw={700} span>
      REPLAY{" "}
      {replay.frame
        ? formatMoment(replay.frame.at, (replay.windowMs ?? 0) > DAY_MS)
        : "loading history…"}
    </Text>{" "}
    · not the live picture; changes to TAK are off
  </Alert>
);

export const ReplayBar = ({ replay }: { replay: ReplayControls }) => {
  const { span, frame, windowMs = 0 } = replay;
  const withDate = windowMs > DAY_MS;
  const cut = span && span.end - span.start < windowMs;

  return (
    <Paper className="tak-replay-bar" p="xs" withBorder>
      <Group gap="xs" wrap="nowrap">
        <ActionIcon
          variant="filled"
          onClick={replay.togglePlay}
          disabled={!frame}
          aria-label={replay.playing ? "Pause" : "Play"}
        >
          {replay.playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
        </ActionIcon>
        <Select
          size="xs"
          w={130}
          data={WINDOWS}
          value={String(windowMs)}
          onChange={(value) => value && replay.setWindowMs(Number(value))}
          allowDeselect={false}
          aria-label="Replay window"
        />
        <SegmentedControl
          size="xs"
          data={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))}
          value={String(replay.speed)}
          onChange={(value) => replay.setSpeed(Number(value))}
          aria-label="Replay speed"
        />
        <ActionIcon
          variant="subtle"
          color="gray"
          ml="auto"
          onClick={replay.stop}
          aria-label="Back to live"
          title="Back to live"
        >
          <IconX size={16} />
        </ActionIcon>
      </Group>
      {replay.error ? (
        <Group gap="xs" mt="xs">
          <Text fz="xs" c="warning.4">
            TAK's history couldn't be loaded.
          </Text>
          <Button size="compact-xs" variant="default" onClick={replay.retry}>
            Retry
          </Button>
        </Group>
      ) : span && frame ? (
        <>
          <Slider
            mt="xs"
            mx="xs"
            size="sm"
            min={span.start}
            max={span.end}
            step={1000}
            value={frame.at}
            onChange={replay.seek}
            label={(at) => formatMoment(at, withDate)}
            aria-label="Replay time"
          />
          <Group justify="space-between" mt={4}>
            <Text fz="xs" c="dimmed">
              {formatMoment(span.start, withDate)}
            </Text>
            {cut && (
              <Text fz="xs" c="warning.4">
                Too much history: replay starts later than asked
              </Text>
            )}
            <Text fz="xs" c="dimmed">
              {formatMoment(span.end, withDate)}
            </Text>
          </Group>
        </>
      ) : (
        <Progress mt="xs" size="sm" value={replay.progress * 100} animated />
      )}
    </Paper>
  );
};
