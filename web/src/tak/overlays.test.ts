import { expect, test } from "vitest";
import type { TakItem } from "./cot.ts";
import { groupOf, groupPathLabel, groupTree, hiddenExcept, isHidden } from "./overlays.ts";

const item = (type: string, extra: { team?: string; callsign?: string } = {}): TakItem => ({
  uid: `${type}-${extra.callsign ?? ""}`,
  type,
  time: 1000,
  stale: 2000,
  geometry: { type: "Point", coordinates: [25, 60] },
  event: {} as TakItem["event"],
  ...extra,
});

test.each([
  ["b-a-o-tbl", ["alerts"]],
  ["a-h-G", ["markers", "hostile"]],
  ["a-s-G", ["markers", "hostile"]],
  ["a-j-A", ["markers", "hostile"]],
  ["a-k-S", ["markers", "hostile"]],
  ["a-f-G-U-C-I", ["markers", "friendly", "troops"]],
  ["a-f-G-E-V-A", ["markers", "friendly", "vehicles"]],
  ["a-f-A", ["markers", "friendly", "air"]],
  ["a-f-S-C", ["markers", "friendly", "ships"]],
  ["a-f-U", ["markers", "friendly", "ships"]],
  ["a-f-G-I-R", ["markers", "friendly", "structures"]],
  ["a-f-G", ["markers", "friendly", "other"]],
  ["a-a-G-U-C", ["markers", "friendly", "other"]],
  ["a-n-G", ["markers", "neutral"]],
  ["a-u-G", ["markers", "unknown"]],
  ["a-p-G", ["markers", "unknown"]],
  ["b-m-p-s-m", ["markers", "spot"]],
  ["b-m-p-s-p-i", ["markers", "spot"]],
  ["b-m-r", ["navigation", "routes"]],
  ["b-m-p-w-GOTO", ["navigation", "waypoints"]],
  ["b-m-p-c", ["navigation", "waypoints"]],
  ["b-m-p-i", ["navigation", "waypoints"]],
  ["u-d-f", ["shapes"]],
  ["u-d-c-c", ["shapes"]],
  ["b-m-p-x", ["other"]],
  ["t-x-c", ["other"]],
])("%s → %j", (type, path) => {
  expect(groupOf(item(type))).toEqual(path);
});

test("a TAK user is grouped by team, whatever its type", () => {
  expect(groupOf(item("a-f-G-U-C", { team: "Cyan" }))).toEqual(["markers", "team", "Cyan"]);
});

test("alerts win over the team", () => {
  expect(groupOf(item("b-a-o-tbl", { team: "Cyan" }))).toEqual(["alerts"]);
});

test("hiding a group hides everything under it", () => {
  const path = ["markers", "friendly", "air"];
  expect(isHidden(path, new Set(["markers"]))).toBe(true);
  expect(isHidden(path, new Set(["markers/friendly/air"]))).toBe(true);
  expect(isHidden(path, new Set(["markers/hostile", "unknown-key"]))).toBe(false);
});

test("showing only some groups hides the rest, but not what they're in or hold", () => {
  const hidden = hiddenExcept(["markers/team", "shapes"]);
  const shown = (type: string, team?: string) => !isHidden(groupOf(item(type, { team })), hidden);
  expect(shown("a-f-G-U-C", "Cyan")).toBe(true);
  expect(shown("u-d-f")).toBe(true);
  expect(shown("a-h-G")).toBe(false);
  expect(shown("a-f-G-U-C")).toBe(false);
  expect(shown("t-x-c")).toBe(false);
  expect(hidden.has("markers")).toBe(false);
});

test("a group's path label tells apart groups sharing a name", () => {
  expect(groupPathLabel("markers/friendly/other")).toBe("Markers › Friendly › Other");
  expect(groupPathLabel("other")).toBe("Other");
});

test("the tree follows ATAK's order, counts its items and sorts teams by name", () => {
  const tree = groupTree([
    item("u-d-f"),
    item("a-h-G"),
    item("a-f-G-U-C", { team: "Yellow", callsign: "a" }),
    item("a-f-G-U-C", { team: "Cyan", callsign: "b" }),
    item("a-f-G-U-C", { team: "Cyan", callsign: "c" }),
  ]);
  expect(tree.map((g) => [g.key, g.count])).toEqual([
    ["markers", 4],
    ["shapes", 1],
  ]);
  const [markers] = tree;
  expect(markers?.children.map((g) => g.label)).toEqual(["Team", "Hostile"]);
  const teams = markers?.children[0]?.children;
  expect(teams?.map((g) => [g.label, g.items.length])).toEqual([
    ["Cyan", 2],
    ["Yellow", 1],
  ]);
});
