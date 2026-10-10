import { IconCalendarTime } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor, WidgetDocumentDescriptor } from "../../dashboard/registry.ts";
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

const timerSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Optional context shown below the timer label. */
  description: z.string().optional(),
  /** Absolute target instant (ISO 8601 UTC). Duration-created timers store now+duration. */
  target: z.string().datetime(),
  /** When set, target contributes its local clock time and repeats every day. */
  recurring: z.boolean().optional(),
});
export type ScheduleTimer = z.infer<typeof timerSchema>;
export type ScheduleDoc = { timers: ScheduleTimer[] };

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

/** The next local daily occurrence, including tomorrow when today's time has passed. */
export const nextTarget = (timer: ScheduleTimer, now: number): Date => {
  const target = new Date(timer.target);
  if (!timer.recurring) return target;
  const next = new Date(now);
  next.setHours(
    target.getHours(),
    target.getMinutes(),
    target.getSeconds(),
    target.getMilliseconds(),
  );
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next;
};

/** Applies an HH:mm clock time to today in the device's local timezone. */
export const todayAtTime = (time: string, now = new Date()): Date | undefined => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  return target;
};

export const widgetDocument: WidgetDocumentDescriptor<ScheduleConfig, ScheduleDoc> = {
  eventType: "schedule",
  empty: { timers: [] },
  parse: (data) => ({ timers: parseTimers(data) }),
  headerFor: (_config, doc) => headerFor(doc.timers),
  // Adding or removing a timer is a complete edit, not mid-typing.
  debounceMs: 500,
};

export const descriptor: WidgetDescriptor<ScheduleConfig> = {
  type: "schedule",
  Icon: IconCalendarTime,
  name: "Schedule",
  description: "Countdown timers to fixed points in time — shared as a versioned event",
  configSchema,
  defaultConfig: {},
  defaultSize: { w: 8, h: 8 },
  minSize: { w: 4, h: 3 },
  document: widgetDocument,
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;
