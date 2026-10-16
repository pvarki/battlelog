import ms from "milsymbol";
import { expect, test } from "vitest";
import {
  cotTypeOf,
  QUICK_SYMBOLS,
  SYMBOL_CATALOGUE,
  type SymbolChoice,
  searchSymbols,
  sidcOf,
} from "./symbol-catalogue.ts";

const infantry = SYMBOL_CATALOGUE.find((s) => s.id === "10121100");
if (!infantry) throw new Error("infantry missing");

const choice = (overrides: Partial<SymbolChoice> = {}): SymbolChoice => ({
  symbol: infantry,
  affiliation: "f",
  echelon: "none",
  status: "present",
  headquarters: false,
  ...overrides,
});

test("friendly infantry is written as ATAK's 2525 point dropper writes it", () => {
  expect(sidcOf(choice())).toBe("10031000001211000000");
  expect(cotTypeOf(choice())).toBe("a-f-G-U-C-I");
  expect(cotTypeOf(choice({ affiliation: "h" }))).toBe("a-h-G-U-C-I");
});

test("affiliation, status, HQ and echelon land in their 2525D digits", () => {
  expect(
    sidcOf(
      choice({ affiliation: "h", status: "destroyed", headquarters: true, echelon: "platoon" }),
    ),
  ).toBe("10061042141211000000");
});

test("echelon and HQ apply to land units only", () => {
  const vehicle = SYMBOL_CATALOGUE.find((s) => s.id === "15120000");
  if (!vehicle) throw new Error("vehicle missing");
  const code = sidcOf(choice({ symbol: vehicle, echelon: "company", headquarters: true }));
  expect(code).toBe("10031500001200000000");
  expect(cotTypeOf(choice({ symbol: vehicle, affiliation: "h" }))).toBe("a-h-G-E-V");
});

test("UAVs keep ATAK's air types", () => {
  const types = QUICK_SYMBOLS.filter((q) => q.label.startsWith("UAV,")).map((q) =>
    cotTypeOf(choice({ symbol: q.symbol })),
  );
  expect(types).toEqual(["a-f-A-M-F-Q", "a-f-A-M-H-Q"]);
});

test("search matches every word in name or group", () => {
  expect(searchSymbols("tank heavy").map((s) => s.name)).toContain("Tank – Heavy");
  expect(searchSymbols("  ")).toEqual([]);
});

test("every catalogue symbol has a unique id and draws in milsymbol", () => {
  expect(new Set(SYMBOL_CATALOGUE.map((s) => s.id)).size).toBe(SYMBOL_CATALOGUE.length);
  const invalid = SYMBOL_CATALOGUE.filter(
    (symbol) => !new ms.Symbol(sidcOf(choice({ symbol }))).isValid(),
  );
  expect(invalid).toEqual([]);
});
