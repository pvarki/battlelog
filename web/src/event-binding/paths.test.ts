import { expect, test } from "vitest";
import { eventLabel, getPath, resolveBound, setPath } from "./paths.ts";

const ID = "6f1c0a52-5c1e-4c1b-9a6e-0d6f2f6a1b11";

test("getPath reads nested scalars and misses cleanly", () => {
  const data = { status: "ready", battery: { level: 80 } };
  expect(getPath(data, "status")).toBe("ready");
  expect(getPath(data, "battery.level")).toBe(80);
  expect(getPath(data, "battery.cells")).toBeUndefined();
  expect(getPath(null, "status")).toBeUndefined();
});

test("setPath replaces one field without mutating or dropping siblings", () => {
  const data = { status: "ready", battery: { level: 80, temp: 20 }, mission: null };
  const next = setPath(data, "battery.level", 79);
  expect(next).toEqual({ status: "ready", battery: { level: 79, temp: 20 }, mission: null });
  expect(data.battery.level).toBe(80);
});

test("resolveBound distinguishes loading, missing event, missing field and value", () => {
  expect(resolveBound(undefined, ID, "status")).toEqual({ state: "loading" });
  expect(resolveBound(null, ID, "status")).toEqual({ state: "missing-event" });
  expect(resolveBound({ data: {} }, "not-a-uuid", "status")).toEqual({ state: "missing-event" });
  expect(resolveBound({ data: { status: "x" } }, ID, "nope")).toEqual({ state: "missing-field" });
  expect(resolveBound({ data: { status: {} } }, ID, "status")).toEqual({ state: "missing-field" });
  expect(resolveBound({ data: { n: 0 } }, ID, "n")).toEqual({ state: "ok", value: 0 });
  expect(resolveBound({ data: { mission: null } }, ID, "mission")).toEqual({
    state: "ok",
    value: null,
  });
});

test("eventLabel prefers the label field and falls back to the header", () => {
  const event = { header: "Drone 1", data: { callsign: "Falcon", empty: " ", nested: { n: 2 } } };
  expect(eventLabel(event, "callsign")).toBe("Falcon");
  expect(eventLabel(event, "nested.n")).toBe("2");
  expect(eventLabel(event, "empty")).toBe("Drone 1");
  expect(eventLabel(event, "nope")).toBe("Drone 1");
  expect(eventLabel(event, "")).toBe("Drone 1");
});
