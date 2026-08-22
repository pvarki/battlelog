import { expect, test } from "vitest";
import { columnKey, columnKeys, evaluateFormula, formulaError } from "./formula.ts";
import descriptor, { parseRows, type TableColumn } from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("a full table config validates", () => {
  const config = {
    title: "Ammo",
    columns: [
      { id: "c1", label: "Item", kind: "text" },
      { id: "c2", label: "Qty", kind: "number" },
      { id: "c3", label: "Unit price", kind: "number" },
      { id: "c4", label: "Total", kind: "formula", formula: "qty * unit_price" },
    ],
  };
  expect(descriptor.configSchema.safeParse(config).success).toBe(true);
});

test("empty column label is rejected", () => {
  expect(
    descriptor.configSchema.safeParse({
      columns: [{ id: "c1", label: "", kind: "text" }],
    }).success,
  ).toBe(false);
});

const columns: TableColumn[] = [
  { id: "c1", label: "Item", kind: "text", formula: undefined },
  { id: "c2", label: "Qty", kind: "number", formula: undefined },
  { id: "c3", label: "Unit price", kind: "number", formula: undefined },
];

test("columnKey normalizes labels to identifiers", () => {
  expect(columnKey("Unit price")).toBe("unit_price");
  expect(columnKey("  Qty ")).toBe("qty");
});

test("evaluateFormula computes over number columns by normalized label", () => {
  expect(evaluateFormula("qty * unit_price", { c2: "4", c3: "2.5" }, columns)).toBe("10");
});

test("evaluateFormula treats empty cells as 0", () => {
  expect(evaluateFormula("qty + unit_price", { c2: "3" }, columns)).toBe("3");
});

test("evaluateFormula strips float noise", () => {
  expect(evaluateFormula("qty + unit_price", { c2: "0.1", c3: "0.2" }, columns)).toBe("0.3");
});

test("evaluateFormula returns #ERR on bad input or bad formula", () => {
  expect(evaluateFormula("qty * unit_price", { c2: "abc", c3: "2" }, columns)).toBe("#ERR");
  expect(evaluateFormula("qty *", { c2: "1" }, columns)).toBe("#ERR");
  expect(evaluateFormula("nosuch + 1", {}, columns)).toBe("#ERR");
  expect(evaluateFormula("qty / unit_price", { c2: "1" }, columns)).toBe("#ERR");
});

test("formulaError flags syntax errors and unknown columns, accepts valid formulas", () => {
  expect(formulaError("qty * unit_price", columns)).toBeNull();
  expect(formulaError("qty *", columns)).toBeTruthy();
  expect(formulaError("nosuch + 1", columns)).toBeTruthy();
});

test("columnKey handles digit-leading and decorated labels", () => {
  expect(columnKey("2024 Qty")).toBe("_2024_qty");
  expect(columnKey("Qty (kg)")).toBe("qty_kg");
});

test("columnKeys dedupes colliding labels in column order", () => {
  const cols: TableColumn[] = [
    { id: "c1", label: "Qty (kg)", kind: "number", formula: undefined },
    { id: "c2", label: "Qty [kg]", kind: "number", formula: undefined },
  ];
  expect([...columnKeys(cols)]).toEqual([
    ["c1", "qty_kg"],
    ["c2", "qty_kg_2"],
  ]);
  expect(evaluateFormula("qty_kg + qty_kg_2", { c1: "1", c2: "2" }, cols)).toBe("3");
});

test("evaluateFormula resolves digit-leading column labels", () => {
  const cols: TableColumn[] = [{ id: "c1", label: "2024 Qty", kind: "number", formula: undefined }];
  expect(evaluateFormula("_2024_qty * 2", { c1: "5" }, cols)).toBe("10");
});

test("parseRows drops malformed entries instead of crashing", () => {
  expect(parseRows({ rows: [{ c1: "a" }, null, [1], { c1: 5 }, "x"] }).rows).toEqual([{ c1: "a" }]);
  expect(parseRows({ rows: "junk" }).rows).toEqual([]);
  expect(parseRows(null).rows).toEqual([]);
});
