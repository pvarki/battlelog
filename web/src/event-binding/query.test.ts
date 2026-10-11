import { expect, test } from "vitest";
import type { EventResponse } from "../api.ts";
import { matchesFeed, queryFor } from "../widgets/feed/widget.ts";
import { queryFilter } from "./query.ts";

const group = { types: " drone, mule ", tags: "", dataFilters: [] };

test("no type means no query, never match-everything", () => {
  expect(queryFilter({ ...group, types: " , " })).toBeUndefined();
});

test("query and live matcher agree on types and data filters", () => {
  const filter = queryFilter({
    ...group,
    dataFilters: [{ id: "f", path: "mission.state", value: "idle" }],
  });
  if (!filter) throw new Error("expected a filter");
  expect(queryFor(filter)).toMatchObject({
    types: "drone,mule",
    data: JSON.stringify({ "mission.state": "idle" }),
  });
  const event = (type: string, data: unknown) => ({ type, data, tags: null }) as EventResponse;
  expect(matchesFeed(event("drone", { mission: { state: "idle" } }), filter)).toBe(true);
  expect(matchesFeed(event("drone", { mission: { state: "busy" } }), filter)).toBe(false);
  expect(matchesFeed(event("person", { mission: { state: "idle" } }), filter)).toBe(false);
});
