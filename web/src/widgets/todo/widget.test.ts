import { expect, test } from "vitest";
import descriptor, { headerFor, parseItems, type TodoItem } from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("eventId must be a uuid", () => {
  expect(
    descriptor.configSchema.safeParse({ eventId: "018f0000-0000-7000-8000-000000000001" }).success,
  ).toBe(true);
  expect(descriptor.configSchema.safeParse({ eventId: "not-a-uuid" }).success).toBe(false);
});

test("parseItems tolerates foreign or malformed event data", () => {
  expect(parseItems(null)).toEqual([]);
  expect(parseItems({ text: "a note, not a todo" })).toEqual([]);
  expect(parseItems({ items: [{ id: "1", text: "x", done: "yes" }] })).toEqual([]);
  const items: TodoItem[] = [{ id: "1", text: "x", done: false }];
  expect(parseItems({ items })).toEqual(items);
});

test("headerFor counts completion", () => {
  expect(headerFor([])).toBe("Todo 0/0");
  expect(
    headerFor([
      { id: "1", text: "a", done: true },
      { id: "2", text: "b", done: false },
    ]),
  ).toBe("Todo 1/2");
});
