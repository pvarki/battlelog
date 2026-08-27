import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useEventDocument } from "../../dashboard/useEventDocument.ts";
import {
  describeRepeat,
  formatDelta,
  headerFor,
  nextOccurrence,
  parseTimers,
  type ScheduleConfig,
  type ScheduleRepeat,
  type ScheduleTimer,
} from "./widget.ts";

type ScheduleDoc = { timers: ScheduleTimer[] };

const formatTarget = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const TimerRow = ({
  timer,
  now,
  onRemove,
}: {
  timer: ScheduleTimer;
  now: number;
  onRemove: () => void;
}) => {
  // The next occurrence, not the stored anchor: a repeating timer rolls forward
  // on its own rather than sitting at PASSED.
  const due = nextOccurrence(timer, now);
  const remaining = due - now;
  const passed = remaining < 0;
  const repeats = describeRepeat(timer.repeat);
  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text fz="sm" fw={500} truncate>
          {timer.label}
        </Text>
        <Text c="dimmed" fz="xs">
          {formatTarget(new Date(due).toISOString())}
          {repeats && ` · ${repeats}`}
        </Text>
      </Stack>
      <Group gap="xs" wrap="nowrap">
        <Text ff="monospace" fw={passed ? 700 : 600} c={passed ? "red" : undefined}>
          {passed ? `PASSED +${formatDelta(-remaining)}` : formatDelta(remaining)}
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="xs"
          aria-label={`Remove ${timer.label}`}
          onClick={onRemove}
        >
          <IconX size={14} stroke={1.5} />
        </ActionIcon>
      </Group>
    </Group>
  );
};

const ScheduleView = ({ config, updateConfig }: WidgetViewProps<ScheduleConfig>) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { value, update, status } = useEventDocument<ScheduleDoc>({
    eventId: config.eventId,
    eventType: "schedule",
    headerFor: (doc) => headerFor(doc.timers),
    empty: { timers: [] },
    parse: (data) => ({ timers: parseTimers(data) }),
    onEventIdCaptured: (id) => updateConfig({ ...config, eventId: id }),
    // Adding or removing a timer is a complete edit, not mid-typing.
    debounceMs: 500,
  });
  const timers = [...value.timers].sort((a, b) => a.target.localeCompare(b.target));

  // Create-modal state.
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<"duration" | "at">("duration");
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState<string | number>(0);
  const [minutes, setMinutes] = useState<string | number>(30);
  const [at, setAt] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [every, setEvery] = useState<"hour" | "day" | "week" | "month" | "custom">("day");
  /** Manually set dates, as datetime-local strings. */
  const [dates, setDates] = useState<string[]>([]);

  const customDates = dates.filter((d) => d && !Number.isNaN(new Date(d).getTime()));
  const repeat: ScheduleRepeat | undefined = !recurring
    ? undefined
    : every === "custom"
      ? customDates.length
        ? { dates: customDates.map((d) => new Date(d).toISOString()) }
        : undefined
      : { every };

  const durationMs = (Number(hours) || 0) * 3_600_000 + (Number(minutes) || 0) * 60_000;
  const targetMs = mode === "duration" ? now + durationMs : new Date(at).getTime();
  const valid =
    label.trim() !== "" &&
    (mode === "duration" ? durationMs > 0 : !Number.isNaN(targetMs) && targetMs > now) &&
    // A custom recurrence with no usable dates would silently become a one-off.
    (!recurring || every !== "custom" || customDates.length > 0);

  const add = () => {
    if (!valid) return;
    update({
      timers: [
        ...value.timers,
        {
          id: crypto.randomUUID(),
          label: label.trim(),
          target: new Date(targetMs).toISOString(),
          ...(repeat ? { repeat } : {}),
        },
      ],
    });
    setOpened(false);
    setLabel("");
    setRecurring(false);
    setDates([]);
  };
  const remove = (id: string) => update({ timers: value.timers.filter((t) => t.id !== id) });

  return (
    <Stack h="100%" gap="xs" p="xs">
      <Stack gap={6} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {timers.length === 0 && status !== "loading" ? (
          <Text c="dimmed" fz="sm">
            No timers yet.
          </Text>
        ) : (
          timers.map((t) => (
            <TimerRow key={t.id} timer={t} now={now} onRemove={() => remove(t.id)} />
          ))
        )}
      </Stack>
      <Button
        size="xs"
        variant="light"
        disabled={status === "loading" || status === "unavailable"}
        onClick={() => setOpened(true)}
      >
        Add timer
      </Button>
      <Text c="dimmed" fz="xs" ta="right" mih="1.2em" role="status">
        {DOC_STATUS_LABEL[status]}
      </Text>

      <Modal opened={opened} onClose={() => setOpened(false)} title="New timer" size="sm">
        <Stack gap="sm">
          <TextInput
            label="Label"
            data-autofocus
            value={label}
            onChange={(e) => setLabel(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <SegmentedControl
            fullWidth
            value={mode}
            onChange={(v) => setMode(v as "duration" | "at")}
            data={[
              { value: "duration", label: "Duration" },
              { value: "at", label: "At time" },
            ]}
          />
          {mode === "duration" ? (
            <Group grow>
              <NumberInput label="Hours" min={0} value={hours} onChange={setHours} />
              <NumberInput label="Minutes" min={0} value={minutes} onChange={setMinutes} />
            </Group>
          ) : (
            <TextInput
              label="Target time"
              description="Interpreted in this device's local time."
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.currentTarget.value)}
            />
          )}
          <Checkbox
            label="Recurring"
            checked={recurring}
            onChange={(e) => setRecurring(e.currentTarget.checked)}
          />
          {recurring && (
            <>
              <SegmentedControl
                fullWidth
                size="xs"
                value={every}
                onChange={(v) => setEvery(v as typeof every)}
                data={[
                  { value: "hour", label: "Hourly" },
                  { value: "day", label: "Daily" },
                  { value: "week", label: "Weekly" },
                  { value: "month", label: "Monthly" },
                  { value: "custom", label: "Custom" },
                ]}
              />
              {every === "custom" ? (
                <Stack gap={6}>
                  <Text fz="xs" c="dimmed">
                    Set each date this repeats on. The countdown follows the next one still to come.
                  </Text>
                  {dates.map((d, i) => (
                    // Index-keyed on purpose: these rows are positional and have
                    // no identity of their own.
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                    <Group key={i} gap="xs" wrap="nowrap">
                      <TextInput
                        size="xs"
                        type="datetime-local"
                        style={{ flex: 1 }}
                        value={d}
                        onChange={(e) => {
                          const next = [...dates];
                          next[i] = e.currentTarget.value;
                          setDates(next);
                        }}
                      />
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        aria-label="Remove date"
                        onClick={() => setDates(dates.filter((_, j) => j !== i))}
                      >
                        <IconX size={14} stroke={1.5} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Button
                    size="xs"
                    variant="light"
                    disabled={dates.length >= 60}
                    onClick={() => setDates([...dates, ""])}
                  >
                    Add date
                  </Button>
                </Stack>
              ) : (
                <Text fz="xs" c="dimmed">
                  Repeats {every === "hour" ? "hourly" : `every ${every}`} from the time above.
                  Daily and longer keep the same clock time across a daylight-saving change.
                </Text>
              )}
            </>
          )}
          <Text c="dimmed" fz="sm">
            {valid
              ? `→ ${formatTarget(new Date(targetMs).toISOString())}, in ${formatDelta(targetMs - now)}`
              : mode === "at" && at !== "" && targetMs <= now
                ? "Target is in the past."
                : " "}
          </Text>
          <Button disabled={!valid} onClick={add}>
            Add
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default ScheduleView;
