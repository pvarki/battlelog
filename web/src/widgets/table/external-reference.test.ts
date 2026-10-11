import { describe, expect, test } from "vitest";
import {
  externalFormulaSourceIds,
  parseExternalFormula,
} from "./external-reference.ts";

const sourceId = "01a1282b-36b7-74f2-83fc-cedfbc75465b";

describe("legacy external table formulas", () => {
  test("parses the UUIDv7 event id syntax for native-formula migration", () => {
    expect(parseExternalFormula(`=!${sourceId}:sum(A1:A2)`)).toEqual({
      eventId: sourceId,
      expression: "sum(A1:A2)",
    });
  });

  test("deduplicates source event ids", () => {
    const formulas = {
      "0:0": `=!${sourceId}:SUM(A1:A2)`,
      "0:1": `=!${sourceId}:AVERAGE($A$1;B2)`,
      "1:0": `=!${sourceId}:$B$1`,
      "1:1": `=!${sourceId}:COUNT(A1:B2)`,
    };

    expect(externalFormulaSourceIds(formulas)).toEqual([sourceId]);
  });
});
