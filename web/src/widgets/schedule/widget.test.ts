import { describe, expect, test } from "vitest";
import descriptor, {
  describeRepeat,
  formatDelta,
  headerFor,
  nextOccurrence,
  parseTimers,
  type ScheduleTimer,
} from "./widget.ts";

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

describe("nextOccurrence", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const timer = (over: Partial<ScheduleTimer>): ScheduleTimer => ({
    id: "t",
    label: "T",
    target: "2026-03-01T09:00:00.000Z",
    ...over,
  });

  test("a one-off is its target, past or future", () => {
    const t = timer({});
    expect(nextOccurrence(t, at("2026-02-01T00:00:00Z"))).toBe(at("2026-03-01T09:00:00Z"));
    // Still the target once passed: that is what the PASSED display reads from.
    expect(nextOccurrence(t, at("2026-04-01T00:00:00Z"))).toBe(at("2026-03-01T09:00:00Z"));
  });

  test("a repeat that has not started yet waits for its anchor", () => {
    const t = timer({ repeat: { every: "day" } });
    expect(nextOccurrence(t, at("2026-02-27T09:00:00Z"))).toBe(at("2026-03-01T09:00:00Z"));
  });

  test("walks forward past however many have been missed", () => {
    const t = timer({ repeat: { every: "day" } });
    const next = nextOccurrence(t, at("2026-03-05T10:00:00Z"));
    expect(new Date(next).toISOString()).toBe("2026-03-06T09:00:00.000Z");
  });

  test("an occurrence exactly now counts as due, not missed", () => {
    const t = timer({ repeat: { every: "hour" } });
    expect(nextOccurrence(t, at("2026-03-01T11:00:00Z"))).toBe(at("2026-03-01T11:00:00Z"));
  });

  test("monthly keeps the day and clamps in a short month", () => {
    const t = timer({ target: "2026-01-31T09:00:00.000Z", repeat: { every: "month" } });
    // Local-time arithmetic, so compare the local day rather than a UTC string.
    const feb = new Date(nextOccurrence(t, at("2026-02-01T00:00:00Z")));
    expect(feb.getMonth()).toBe(1);
    expect(feb.getDate()).toBe(28);
    const mar = new Date(nextOccurrence(t, at("2026-03-01T00:00:00Z")));
    expect(mar.getMonth()).toBe(2);
    expect(mar.getDate()).toBe(31);
  });

  test("manual dates give the next one due, then stay at the last", () => {
    const t = timer({
      repeat: {
        dates: ["2026-03-10T06:00:00.000Z", "2026-03-02T06:00:00.000Z", "2026-03-20T06:00:00.000Z"],
      },
    });
    // Order in the list does not matter
    expect(nextOccurrence(t, at("2026-03-01T00:00:00Z"))).toBe(at("2026-03-02T06:00:00Z"));
    expect(nextOccurrence(t, at("2026-03-05T00:00:00Z"))).toBe(at("2026-03-10T06:00:00Z"));
    // All done: the last one, so it reads as passed instead of jumping back
    expect(nextOccurrence(t, at("2026-04-01T00:00:00Z"))).toBe(at("2026-03-20T06:00:00Z"));
  });

  test("describeRepeat says what it does", () => {
    expect(describeRepeat(undefined)).toBe("");
    expect(describeRepeat({ every: "week" })).toBe("every week");
    expect(describeRepeat({ dates: ["2026-03-02T06:00:00.000Z"] })).toBe("1 set date");
  });
});
