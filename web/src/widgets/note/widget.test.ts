import { expect, test } from "vitest";
import descriptor, { headerFor } from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("eventId must be a uuid", () => {
  expect(
    descriptor.configSchema.safeParse({ eventId: "018f0000-0000-7000-8000-000000000001" }).success,
  ).toBe(true);
  expect(descriptor.configSchema.safeParse({ eventId: "not-a-uuid" }).success).toBe(false);
});

test("headerFor derives the event header from the first line", () => {
  expect(headerFor("Contact at bridge\nmore details")).toBe("Contact at bridge");
  expect(headerFor("")).toBe("Note");
  expect(headerFor("\n\nsecond line only")).toBe("Note");
  expect(headerFor(`${"x".repeat(100)}`)).toHaveLength(80);
});
