import { expect, test } from "vitest";
import { activeGroupsRequest, parseGroups, withActive } from "./groups.ts";

const group = (name: string, direction: string, active: boolean) => ({
  name,
  direction,
  created: "2024-01-01",
  type: "SYSTEM",
  bitpos: 2,
  active,
});

const response = {
  version: "3",
  type: "com.bbn.marti.remote.groups.Group",
  data: [
    group("__ANON__", "IN", true),
    group("__ANON__", "OUT", true),
    group("Kaarti", "OUT", false),
    group("broken", "SIDEWAYS", true),
  ],
};

test("groups parse one entry per direction, skipping malformed ones", () => {
  expect(parseGroups(response).map((g) => `${g.name} ${g.direction} ${g.active}`)).toEqual([
    "__ANON__ IN true",
    "__ANON__ OUT true",
    "Kaarti OUT false",
  ]);
  expect(parseGroups({})).toEqual([]);
  expect(parseGroups(null)).toEqual([]);
});

test("toggling a group changes only that direction and keeps TAK's fields for the PUT", () => {
  const groups = parseGroups(response);
  const next = withActive(groups, groups[0] as (typeof groups)[0], false);

  expect(activeGroupsRequest(next, "BattleLog-Eversti")).toEqual({
    method: "PUT",
    path: "/Marti/api/groups/active?clientUid=BattleLog-Eversti",
    body: [
      group("__ANON__", "IN", false),
      group("__ANON__", "OUT", true),
      group("Kaarti", "OUT", false),
    ],
  });
});
