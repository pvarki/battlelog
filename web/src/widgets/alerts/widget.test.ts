import { expect, test } from "vitest";
import { type Alert, DISMISS_EVENT_TYPE, dismissedKeys, matchesAlert } from "../../alerts.ts";
import type { EventResponse } from "../../api.ts";
import descriptor, { raisedAlerts } from "./widget.ts";

const event = (over: Partial<EventResponse> = {}): EventResponse =>
  ({
    id: "e1",
    header: "Hostile, Ground, Infantry",
    type: "tak-cot",
    tags: ["tak", "a-h-G-U-C-I"],
    createdBy: "tak:PARTIO-3",
    createdAt: "2026-08-27T10:00:00.000Z",
    eventTime: "2026-08-27T09:59:00.000Z",
    data: { desk: "ARKI" },
    ...over,
  }) as EventResponse;

const rule = (over: Partial<Alert> = {}): Alert => ({
  id: "a1",
  label: "Vihollishavainto",
  severity: "critical",
  search: "",
  dataKey: "",
  dataValue: "",
  createdBy: "",
  ...over,
});

test("schema defaults and rejects unknown keys", () => {
  const parsed = descriptor.configSchema.parse({});
  expect(parsed).toMatchObject({ lookback: 200, showDismissed: false });
  expect(descriptor.configSchema.safeParse({ nonesuch: 1 }).success).toBe(false);
  // The settings drawer writes showOnMobile into any widget's config.
  expect(descriptor.configSchema.safeParse({ showOnMobile: false }).success).toBe(true);
});

test("a rule matches on any one condition and requires all of them", () => {
  expect(matchesAlert(event(), rule({ types: ["tak-cot"] }))).toBe(true);
  expect(matchesAlert(event(), rule({ types: ["matrix.message"] }))).toBe(false);
  expect(matchesAlert(event(), rule({ search: "hostile" }))).toBe(true);
  expect(matchesAlert(event(), rule({ dataKey: "desk", dataValue: "ARKI" }))).toBe(true);
  expect(matchesAlert(event(), rule({ dataKey: "desk", dataValue: "MATI" }))).toBe(false);
  // AND, not OR: the type matches but the sender does not.
  expect(matchesAlert(event(), rule({ types: ["tak-cot"], createdBy: "tak:muu" }))).toBe(false);
});

test("an acknowledgement never raises an alert", () => {
  // Otherwise dismissing one alert files an event that raises the next, forever.
  const ack = event({ id: "e2", type: DISMISS_EVENT_TYPE, header: "Kuitattu: x" });
  expect(matchesAlert(ack, rule())).toBe(false);
  expect(raisedAlerts([ack], [{ alert: rule(), source: "Päivystys" }])).toEqual([]);
});

test("one event raising two rules is two things to acknowledge", () => {
  const rules = [
    { alert: rule({ id: "a1", label: "Vihollinen" }), source: "Päivystys" },
    { alert: rule({ id: "a2", label: "TAK", types: ["tak-cot"] }), source: "Tilanne" },
  ];
  const raised = raisedAlerts([event()], rules);
  expect(raised.map((r) => r.key)).toEqual(["a1:e1", "a2:e1"]);
});

test("newest first, whatever order the events arrived in", () => {
  const rules = [{ alert: rule(), source: "Päivystys" }];
  const raised = raisedAlerts(
    [
      event({ id: "old", createdAt: "2026-08-27T08:00:00.000Z" }),
      event({ id: "new", createdAt: "2026-08-27T12:00:00.000Z" }),
    ],
    rules,
  );
  expect(raised.map((r) => r.event.id)).toEqual(["new", "old"]);
});

test("dismissals are read back by alert and event, not by alert alone", () => {
  const cleared = dismissedKeys([
    event({ id: "d1", type: DISMISS_EVENT_TYPE, data: { alertId: "a1", eventId: "e1" } }),
    // Malformed dismissal: ignored rather than throwing.
    event({ id: "d2", type: DISMISS_EVENT_TYPE, data: { alertId: "a1" } }),
  ]);
  expect(cleared.has("a1:e1")).toBe(true);
  // The same rule firing on a different event is still open.
  expect(cleared.has("a1:e9")).toBe(false);
});
