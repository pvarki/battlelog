import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./pg-error.ts";

describe("isUniqueViolation", () => {
  const pg = { code: "23505", constraint: "events_update_for_unique" };

  it("reads the pg error thrown directly", () => {
    expect(isUniqueViolation(pg, "events_update_for_unique")).toBe(true);
  });

  it("reads it through drizzle's wrapper", () => {
    // Drizzle 0.45 wraps driver errors in DrizzleQueryError. Reading only the
    // top level turned two deliberate 409s into 500s on upgrade — that is the
    // regression this test exists for.
    const wrapped = new Error("Failed query");
    (wrapped as unknown as { cause: unknown }).cause = pg;
    expect(isUniqueViolation(wrapped, "events_update_for_unique")).toBe(true);
  });

  it("does not match another constraint or another error", () => {
    expect(isUniqueViolation(pg, "dashboards_template_name_unique")).toBe(false);
    expect(isUniqueViolation({ code: "23503", constraint: "x" }, "x")).toBe(false);
    expect(isUniqueViolation(null, "x")).toBe(false);
    expect(isUniqueViolation(new Error("plain"), "x")).toBe(false);
  });

  it("gives up rather than looping on a self-referential cause", () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop, "x")).toBe(false);
  });
});
