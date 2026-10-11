import { expect, test } from "vitest";
import type { BoundState } from "../../event-binding/paths.ts";
import { compareCells, defaultFilters, matchesFilter } from "./table.ts";
import type { TableColumn } from "./widget.ts";

const ok = (value: string | number | boolean | null): BoundState => ({ state: "ok", value });
const missing: BoundState = { state: "missing-field" };

test("sorts numbers numerically, text naturally, empty and missing last both ways", () => {
  const cells = [ok(10), missing, ok(9), ok(null), ok(100)];
  const asc = [...cells].sort((a, b) => compareCells(a, b, "asc"));
  expect(asc.slice(0, 3)).toEqual([ok(9), ok(10), ok(100)]);
  const desc = [...cells].sort((a, b) => compareCells(a, b, "desc"));
  expect(desc.slice(0, 3)).toEqual([ok(100), ok(10), ok(9)]);
  expect(desc.slice(3).every((c) => c.state !== "ok" || c.value === null)).toBe(true);
  expect(compareCells(ok("Drone 10"), ok("Drone 9"), "asc")).toBeGreaterThan(0);
});

test("filters by kind; missing fields never match an active filter", () => {
  expect(matchesFilter(ok("Recon"), "text", { text: "rec" }, "Recon")).toBe(true);
  expect(matchesFilter(ok("Recon"), "text", { text: "x" }, "Recon")).toBe(false);
  expect(matchesFilter(ok(50), "count", { min: "40", max: "60" }, "50")).toBe(true);
  expect(matchesFilter(ok(70), "count", { max: "60" }, "70")).toBe(false);
  expect(matchesFilter(ok("ready"), "choice", { values: ["ready", "busy"] }, "ready")).toBe(true);
  expect(matchesFilter(ok("down"), "choice", { values: ["ready"] }, "down")).toBe(false);
  expect(matchesFilter(ok(null), "boolean", { bool: "no" }, "")).toBe(true);
  expect(matchesFilter(ok(true), "boolean", { bool: "no" }, "")).toBe(false);
  expect(matchesFilter(missing, "text", { text: "a" }, "")).toBe(false);
  expect(matchesFilter(missing, "text", {}, "")).toBe(true);
});

test("only active default filters are applied on open", () => {
  const col: Omit<TableColumn, "id"> = {
    label: "",
    source: "data",
    field: "",
    kind: "text",
    options: [],
    editable: false,
  };
  expect(
    defaultFilters([
      { ...col, id: "a", defaultFilter: { text: "x" } },
      { ...col, id: "b", defaultFilter: { text: " " } },
      { ...col, id: "c" },
    ]),
  ).toEqual({ a: { text: "x" } });
});
