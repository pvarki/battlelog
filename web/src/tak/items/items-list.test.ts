import { expect, test } from "vitest";
import type { TakItem } from "../cot.ts";
import { groupTree } from "../overlays.ts";
import {
  ancestorKeys,
  BIG_GROUP,
  groupKeys,
  isGroupOpen,
  listRows,
  matchesQuery,
  type Row,
} from "./items-list.ts";

const item = (uid: string, type: string, extra: Partial<TakItem> = {}): TakItem => ({
  uid,
  type,
  time: 0,
  stale: 1,
  geometry: { type: "Point", coordinates: [25, 60] },
  event: {} as TakItem["event"],
  ...extra,
});

const indented = (rows: Row[]) => rows.map((r) => `${"  ".repeat(r.depth)}${r.key}`);
const allOpen = () => true;

test("the query matches name, team, type or uid, ignoring case and spaces", () => {
  const cyan = item("u-1", "a-f-G-U-C", { callsign: "Bravo", team: "Cyan" });
  expect(matchesQuery(cyan, "  ")).toBe(true);
  expect(matchesQuery(cyan, "brav")).toBe(true);
  expect(matchesQuery(cyan, " CYAN ")).toBe(true);
  expect(matchesQuery(cyan, "u-1")).toBe(true);
  expect(matchesQuery(cyan, "hostile")).toBe(false);
});

test("sorted by name, rows are the group tree with items after subgroups, by name", () => {
  const rows = listRows(
    [
      item("zulu", "a-h-G", { callsign: "Zulu" }),
      item("troop", "a-f-G-U-C"),
      item("alpha", "a-h-G", { callsign: "Alpha" }),
    ],
    { sort: "name", from: undefined, hidden: new Set(), isOpen: allOpen },
  );
  expect(indented(rows)).toEqual([
    "markers",
    "  markers/hostile",
    "    alpha",
    "    zulu",
    "  markers/friendly",
    "    markers/friendly/troops",
    "      troop",
  ]);
});

test("a closed group shows only its header", () => {
  const rows = listRows([item("h", "a-h-G")], {
    sort: "name",
    from: undefined,
    hidden: new Set(),
    isOpen: (g) => g.key !== "markers/hostile",
  });
  expect(indented(rows)).toEqual(["markers", "  markers/hostile"]);
  expect(rows[1]).toMatchObject({ kind: "group", open: false });
});

test("a hidden group dims itself and everything under it", () => {
  const rows = listRows([item("h", "a-h-G"), item("s", "u-d-f")], {
    sort: "name",
    from: undefined,
    hidden: new Set(["markers"]),
    isOpen: allOpen,
  });
  expect(Object.fromEntries(rows.map((r) => [r.key, r.dimmed]))).toEqual({
    markers: true,
    "markers/hostile": true,
    h: true,
    shapes: false,
    s: false,
  });
  expect(rows.find((r) => r.key === "markers")).toMatchObject({ ownHidden: true });
  expect(rows.find((r) => r.key === "markers/hostile")).toMatchObject({ ownHidden: false });
});

test("other sorts list items flat, dimmed when their group is hidden", () => {
  const rows = listRows([item("old", "a-h-G", { time: 1 }), item("new", "u-d-f", { time: 2 })], {
    sort: "newest",
    from: undefined,
    hidden: new Set(["markers"]),
    isOpen: allOpen,
  });
  expect(rows.map((r) => [r.key, r.depth, r.dimmed])).toEqual([
    ["new", 0, false],
    ["old", 0, true],
  ]);
});

test("big groups start closed, the user's choice wins, and searching opens all", () => {
  const big = { key: "k", label: "K", count: 0, items: Array(BIG_GROUP + 1), children: [] };
  const small = { ...big, items: [] };
  expect(isGroupOpen(small, {}, false)).toBe(true);
  expect(isGroupOpen(big, {}, false)).toBe(false);
  expect(isGroupOpen(big, { k: true }, false)).toBe(true);
  expect(isGroupOpen(small, { k: false }, false)).toBe(false);
  expect(isGroupOpen(small, { k: false }, true)).toBe(true);
});

test("group keys cover the whole tree; an item's ancestors run outermost first", () => {
  const troop = item("t", "a-f-G-U-C");
  expect(groupKeys(groupTree([troop, item("s", "u-d-f")]))).toEqual([
    "markers",
    "markers/friendly",
    "markers/friendly/troops",
    "shapes",
  ]);
  expect(ancestorKeys(troop)).toEqual(["markers", "markers/friendly", "markers/friendly/troops"]);
});
