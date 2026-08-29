import { describe, expect, it } from "vitest";
import { describeCotType } from "./tak.symbol.ts";

describe("describeCotType", () => {
  it("reads an atom as affiliation, dimension and function", () => {
    expect(describeCotType("a-f-G-U-C-I")).toBe("Friendly, Ground, Infantry");
    expect(describeCotType("a-h-G-U-C-A")).toBe("Hostile, Ground, Armour");
    expect(describeCotType("a-u-G")).toBe("Unknown, Ground");
  });

  it("names the whole type for messages and drawings", () => {
    expect(describeCotType("b-t-f")).toBe("Chat message");
    expect(describeCotType("u-d-r")).toBe("Rectangle");
  });

  it("passes unrecognised codes through instead of guessing", () => {
    // Known down to Ground, then a function chain 2525 has but this table does not.
    expect(describeCotType("a-f-G-Q-Z-Z")).toBe("Friendly, Ground, Q-Z-Z");
    // Not an atom and not a known whole type: nothing to say, so say the type.
    expect(describeCotType("q-z-nonsense")).toBe("q-z-nonsense");
    expect(describeCotType("a-f")).toBe("a-f");
  });
});
