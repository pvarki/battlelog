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
import { DateTimePicker, TimePicker } from "@mantine/dates";
import { IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useWidgetDocument } from "../../dashboard/useEventDocument.ts";
import {
  formatDelta,
  nextTarget,
  type ScheduleConfig,
  type ScheduleTimer,
  todayAtTime,
  widgetDocument,
} from "./widget.ts";

const formatTarget = (iso: string): string =>
  new Intl.DateTimeFormat("fi-FI", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

const formatTime = (date: Date): string =>
  new Intl.DateTimeFormat("fi-FI", { hour: "2-digit", minute: "2-digit" }).format(date);

const TimerRow = ({
  timer,
  now,
  onRemove,
}: {
  timer: ScheduleTimer;
  now: number;
  onRemove: () => void;
}) => {
  const target = nextTarget(timer, now);
  const remaining = target.getTime() - now;
  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text fz="sm" fw={500} truncate>
          {timer.label}
        </Text>
        <Text c="dimmed" fz="xs">
          {timer.recurring ? `Joka päivä klo ${formatTime(target)}` : formatTarget(timer.target)}
        </Text>
      </Stack>
      <Group gap="xs" wrap="nowrap">
        <Text ff="monospace" fw={600}>
          {formatDelta(remaining)}
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

const ScheduleView = ({
  config,
  dashboardIsTemplate,
  updateConfig,
}: WidgetViewProps<ScheduleConfig>) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { value, update, status } = useWidgetDocument({
    config,
    updateConfig,
    dashboardIsTemplate,
    document: widgetDocument,
  });
  const timers = [...value.timers].sort(
    (a, b) => nextTarget(a, now).getTime() - nextTarget(b, now).getTime(),
  );

  // Create-modal state.
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<"duration" | "at">("duration");
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState<string | number>(0);
  const [minutes, setMinutes] = useState<string | number>(30);
  const [at, setAt] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [recurringTime, setRecurringTime] = useState("");

  const durationMs = (Number(hours) || 0) * 3_600_000 + (Number(minutes) || 0) * 60_000;
  const recurringTarget = todayAtTime(recurringTime);
  const targetMs =
    mode === "duration"
      ? now + durationMs
      : recurring
        ? (recurringTarget?.getTime() ?? Number.NaN)
        : new Date(at).getTime();
  const valid =
    label.trim() !== "" &&
    (mode === "duration"
      ? durationMs > 0
      : !Number.isNaN(targetMs) && (recurring || targetMs > now));

  const add = () => {
    if (!valid) return;
    update({
      timers: [
        ...value.timers,
        {
          id: crypto.randomUUID(),
          label: label.trim(),
          target: new Date(targetMs).toISOString(),
          ...(recurring ? { recurring: true } : {}),
        },
      ],
    });
    setOpened(false);
    setLabel("");
    setRecurring(false);
    setRecurringTime("");
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
            <Stack gap="xs">
              <Checkbox
                label="Recurring"
                checked={recurring}
                onChange={(event) => setRecurring(event.currentTarget.checked)}
              />
              {recurring ? (
                <TimePicker
                  label="Time"
                  description="Interpreted in this device's local time."
                  minutesStep={5}
                  value={recurringTime}
                  onChange={setRecurringTime}
                />
              ) : (
                <DateTimePicker
                  label="Target time"
                  description="Interpreted in this device's local time."
                  placeholder="Select date and time"
                  locale="fi"
                  value={at ? at.replace("T", " ") : null}
                  valueFormat="DD.MM.YYYY HH:mm"
                  timePickerProps={{ minutesStep: 5 }}
                  onChange={(next) => setAt(next?.replace(" ", "T") ?? "")}
                />
              )}
            </Stack>
          )}
          <Text c="dimmed" fz="sm">
            {valid
              ? `→ ${formatTarget(new Date(targetMs).toISOString())}, in ${formatDelta(targetMs - now)}`
              : mode === "at" && !recurring && at !== "" && targetMs <= now
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
