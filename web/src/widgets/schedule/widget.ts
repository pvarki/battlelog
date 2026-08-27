import { IconCalendarTime } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

const configSchema = z
  .object({
    ...baseWidgetConfig,
    /**
     * Logical event id the timer list follows: timers live in the event log as
     * a type:"schedule" event, and every change appends a version to its chain.
     * Unset until the first save creates the event; point two widgets at the
     * same id to share a list, or clear to start a new one on next edit.
     */
    eventId: z.string().uuid().optional(),
  })
  .strict();

export type ScheduleConfig = z.infer<typeof configSchema>;

/**
 * How a timer repeats.
 *
 * `every` walks forward from the timer's target in calendar steps, so a daily
 * timer set for 09:00 stays at 09:00 across a daylight-saving change rather than
 * drifting an hour. `dates` is the manual case: an explicit list of instants,
 * used as given.
 */
const repeatSchema = z.union([
  z.object({ every: z.enum(["hour", "day", "week", "month"]) }).strict(),
  z.object({ dates: z.array(z.string().datetime()).min(1).max(60) }).strict(),
]);
export type ScheduleRepeat = z.infer<typeof repeatSchema>;

const timerSchema = z.object({
  id: z.string(),
  label: z.string(),
  /**
   * Absolute target instant (ISO 8601 UTC). Duration-created timers store
   * now+duration. For a repeating timer this is the first occurrence and stays
   * put: later occurrences are derived, so a rollover never writes to the
   * document and every viewer computes the same next time.
   */
  target: z.string().datetime(),
  repeat: repeatSchema.optional(),
});
export type ScheduleTimer = z.infer<typeof timerSchema>;

/** Add months keeping the day where possible; a short month clamps to its end. */
const addMonths = (d: Date, months: number): Date => {
  const day = d.getDate();
  const shifted = new Date(d);
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + months);
  const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  shifted.setDate(Math.min(day, lastDay));
  return shifted;
};

/**
 * Occurrence number `k`, counted from the anchor.
 *
 * Always derived from the anchor rather than from the previous occurrence: a
 * monthly timer anchored on the 31st must give 28 Feb and then 31 Mar, and
 * stepping from the clamped February date would strand it on the 28th forever.
 * Local calendar arithmetic, so a daily 09:00 stays 09:00 across a
 * daylight-saving change instead of drifting an hour.
 */
const occurrenceOf = (anchor: Date, every: "hour" | "day" | "week" | "month", k: number): Date => {
  const at = new Date(anchor);
  switch (every) {
    case "hour":
      at.setHours(at.getHours() + k);
      return at;
    case "day":
      at.setDate(at.getDate() + k);
      return at;
    case "week":
      at.setDate(at.getDate() + k * 7);
      return at;
    case "month":
      return addMonths(at, k);
  }
};

/** Rough length of one step, only ever used to guess a starting index. */
const APPROX_MS: Record<"hour" | "day" | "week" | "month", number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_800_000,
};

/**
 * When this timer next fires, at or after `now`.
 *
 * A non-repeating timer is simply its target, which may be in the past — that is
 * what the PASSED display reads from. A repeating one is derived from its
 * anchor, so a rollover never writes to the document and every viewer computes
 * the same next time.
 */
export const nextOccurrence = (timer: ScheduleTimer, now: number): number => {
  const anchor = new Date(timer.target).getTime();
  if (!timer.repeat || Number.isNaN(anchor)) return anchor;

  if ("dates" in timer.repeat) {
    const times = timer.repeat.dates
      .map((d) => new Date(d).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);
    // The next one due, else the last, so a finished list reads as passed
    // rather than silently reverting to the anchor.
    return times.find((t) => t >= now) ?? times.at(-1) ?? anchor;
  }

  if (anchor >= now) return anchor;
  const { every } = timer.repeat;
  const from = new Date(anchor);

  // Jump most of the way arithmetically, then walk the last steps so calendar
  // effects land exactly right. A timer neglected for a year is a few steps,
  // not thousands.
  let k = Math.max(0, Math.floor((now - anchor) / APPROX_MS[every]));
  while (k > 0 && occurrenceOf(from, every, k - 1).getTime() >= now) k -= 1;
  while (occurrenceOf(from, every, k).getTime() < now) k += 1;
  return occurrenceOf(from, every, k).getTime();
};

/** How a repeat reads in the list, e.g. "every day". */
export const describeRepeat = (repeat: ScheduleRepeat | undefined): string => {
  if (!repeat) return "";
  if ("dates" in repeat) {
    return `${repeat.dates.length} set date${repeat.dates.length === 1 ? "" : "s"}`;
  }
  return `every ${repeat.every}`;
};

/** Tolerant read: an event with foreign or malformed data renders empty, not a crash. */
export const parseTimers = (data: unknown): ScheduleTimer[] => {
  const parsed = z.object({ timers: z.array(timerSchema) }).safeParse(data);
  return parsed.success ? parsed.data.timers : [];
};

/** Event header shown in the log. */
export const headerFor = (timers: ScheduleTimer[]): string =>
  `Schedule ${timers.length} timer${timers.length === 1 ? "" : "s"}`;

const pad = (n: number) => String(n).padStart(2, "0");

/** Non-negative ms → "HH:MM:SS", with a days prefix past 24h. */
export const formatDelta = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hms = `${pad(Math.floor((total % 86400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return days > 0 ? `${days}d ${hms}` : hms;
};

const descriptor: WidgetDescriptor<ScheduleConfig> = {
  type: "schedule",
  Icon: IconCalendarTime,
  name: "Schedule",
  description: "Countdown timers to fixed points in time — shared as a versioned event",
  configSchema,
  defaultConfig: {},
  defaultSize: { w: 8, h: 8 },
  minSize: { w: 4, h: 3 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;
