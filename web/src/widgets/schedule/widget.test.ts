import { expect, test } from "vitest";
import descriptor, { formatDelta, headerFor, parseTimers, type ScheduleTimer } from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("eventId must be a uuid", () => {
  expect(
    descriptor.configSchema.safeParse({ eventId: "018f0000-0000-7000-8000-000000000001" }).success,
  ).toBe(true);
  expect(descriptor.configSchema.safeParse({ eventId: "not-a-uuid" }).success).toBe(false);
});

test("parseTimers tolerates foreign or malformed event data", () => {
  expect(parseTimers(null)).toEqual([]);
  expect(parseTimers({ items: [] })).toEqual([]);
  expect(parseTimers({ timers: [{ id: "1", label: "x", target: "not-a-date" }] })).toEqual([]);
  const timers: ScheduleTimer[] = [
    { id: "1", label: "SITREP", target: "2026-08-22T14:30:00.000Z" },
  ];
  expect(parseTimers({ timers })).toEqual(timers);
});

test("headerFor counts timers", () => {
  expect(headerFor([])).toBe("Schedule 0 timers");
  expect(headerFor([{ id: "1", label: "a", target: "2026-08-22T14:30:00.000Z" }])).toBe(
    "Schedule 1 timer",
  );
  expect(
    headerFor([
      { id: "1", label: "a", target: "2026-08-22T14:30:00.000Z" },
      { id: "2", label: "b", target: "2026-08-22T15:00:00.000Z" },
    ]),
  ).toBe("Schedule 2 timers");
});

test("formatDelta renders HH:MM:SS", () => {
  expect(formatDelta(0)).toBe("00:00:00");
  expect(formatDelta(61_000)).toBe("00:01:01");
  expect(formatDelta(3_600_000 + 23 * 60_000 + 45_000)).toBe("01:23:45");
});

test("formatDelta prefixes days past 24h", () => {
  expect(formatDelta(90 * 3_600_000)).toBe("3d 18:00:00");
});

test("formatDelta truncates sub-second remainders and clamps negatives", () => {
  expect(formatDelta(999)).toBe("00:00:00");
  expect(formatDelta(-5_000)).toBe("00:00:00");
});
