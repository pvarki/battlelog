import { expect, test } from "vitest";
import type { EventResponse } from "../../api.ts";
import descriptor, { matchesFeed, queryFor } from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("schema applies defaults and rejects unknown columns", () => {
  const parsed = descriptor.configSchema.safeParse({});
  expect(parsed.success && parsed.data.rows).toBe(10);
  expect(parsed.success && parsed.data.columns).toEqual(["time", "header", "type"]);
  expect(descriptor.configSchema.safeParse({ columns: ["location"] }).success).toBe(false);
  expect(descriptor.configSchema.safeParse({ columns: [] }).success).toBe(false);
});

const base = descriptor.defaultConfig;
const row = (over: Partial<EventResponse>): EventResponse =>
  ({
    header: "Contact at bridge",
    type: "foe-movement",
    tags: ["1.K"],
    createdBy: "cn",
    ...over,
  }) as EventResponse;

test("matchesFeed mirrors the query semantics", () => {
  expect(matchesFeed(row({}), base)).toBe(true);
  expect(matchesFeed(row({}), { ...base, types: ["foe-movement"] })).toBe(true);
  expect(matchesFeed(row({ type: null }), { ...base, types: ["foe-movement"] })).toBe(false);
  expect(matchesFeed(row({}), { ...base, tags: ["2.K", "1.K"] })).toBe(true);
  expect(matchesFeed(row({ tags: null }), { ...base, tags: ["1.K"] })).toBe(false);
  expect(matchesFeed(row({}), { ...base, search: "AT BRIDGE" })).toBe(true);
  expect(matchesFeed(row({}), { ...base, search: "mortar" })).toBe(false);
  expect(matchesFeed(row({}), { ...base, createdBy: "someone-else" })).toBe(false);
});

test("queryFor emits csv params and omits empty filters", () => {
  expect(queryFor(base)).toEqual({});
  expect(queryFor({ ...base, types: ["a", "b"], tags: ["x"], search: "s" })).toEqual({
    types: "a,b",
    tags: "x",
    search: "s",
  });
});
