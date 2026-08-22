import { expect, test } from "vitest";
import { buildStatusTree, flattenTree, parseLabel } from "./tree.ts";
import type { StatusRow } from "./widget.ts";

const row = (id: string, label: string): StatusRow => ({ id, label, kind: "choice", options: [] });

test("parseLabel trims segments and caps at 3 levels", () => {
  expect(parseLabel("Pena")).toEqual(["Pena"]);
  expect(parseLabel("1. ryhmä / Pena")).toEqual(["1. ryhmä", "Pena"]);
  expect(parseLabel("a/b/c/d/e")).toEqual(["a", "b", "c / d / e"]);
  expect(parseLabel("//")).toEqual(["//"]);
});

test("children nest under their group in config order", () => {
  const flat = flattenTree(
    buildStatusTree([row("1", "1.rj/Pena"), row("2", "2.rj/Töppö"), row("3", "1.rj/Masa")]),
  );
  expect(flat.map((n) => [n.name, n.depth, !!n.row])).toEqual([
    ["1.rj", 0, false],
    ["Pena", 1, true],
    ["Masa", 1, true],
    ["2.rj", 0, false],
    ["Töppö", 1, true],
  ]);
});

test("a group root with its own row shows both chip and children", () => {
  const flat = flattenTree(buildStatusTree([row("1", "1.rj"), row("2", "1.rj/Pena")]));
  expect(flat.map((n) => [n.path, n.depth, n.row?.id])).toEqual([
    ["1.rj", 0, "1"],
    ["1.rj/Pena", 1, "2"],
  ]);
});

test("three levels nest with increasing depth", () => {
  const flat = flattenTree(buildStatusTree([row("1", "K/1.j/Pena")]));
  expect(flat.map((n) => n.depth)).toEqual([0, 1, 2]);
  expect(flat[2]?.row?.id).toBe("1");
});
