import { describe, expect, test, vi } from "vitest";
import { descendantsOf, missionTree, parseParent } from "./hierarchy.ts";
import type { Mission } from "./missions.ts";

const mission = (name: string, changedAt: number): Mission => ({
  name,
  description: "",
  creatorUid: undefined,
  createTime: 0,
  keywords: [],
  passwordProtected: false,
  inviteOnly: false,
  defaultRole: undefined,
  itemUids: [],
  files: [],
  changedAt,
  version: "",
});

const names = (rows: ReturnType<typeof missionTree>) =>
  rows.map((r) => `${"-".repeat(r.depth)}${r.mission.name}`);

describe("missionTree", () => {
  test("children follow their parent, newest change first at each level", () => {
    const missions = [
      mission("op", 1),
      mission("recon", 5),
      mission("north", 2),
      mission("south", 3),
    ];
    const parents = new Map([
      ["north", "op"],
      ["south", "op"],
      ["op", null],
      ["recon", null],
    ]);
    expect(names(missionTree(missions, parents))).toEqual(["recon", "op", "-south", "-north"]);
  });

  test("a parent that isn't listed, or a cycle, leaves the mission a root", () => {
    const missions = [mission("a", 3), mission("b", 2), mission("orphan", 1)];
    const parents = new Map([
      ["a", "b"],
      ["b", "a"],
      ["orphan", "hidden"],
    ]);
    const rows = missionTree(missions, parents);
    expect(rows.map((r) => r.mission.name).sort()).toEqual(["a", "b", "orphan"]);
    expect(rows.find((r) => r.mission.name === "orphan")?.depth).toBe(0);
  });
});

test("descendantsOf finds every level below, never the mission itself", () => {
  const parents = new Map([
    ["north", "op"],
    ["north-1", "north"],
    ["op", "op"],
    ["recon", null],
  ]);
  expect([...descendantsOf("op", parents)].sort()).toEqual(["north", "north-1"]);
});

test("parseParent reads the parent mission's name", () => {
  expect(parseParent({ data: { name: "Op North" } })).toBe("Op North");
  expect(parseParent({ data: [{ name: "Op North" }] })).toBe("Op North");
  expect(parseParent({ data: {} })).toBeUndefined();
});

describe("parent cache", () => {
  test("an older read still in flight can't undo a parent this client just confirmed", async () => {
    vi.resetModules();
    let answer: (text: string) => void = () => undefined;
    vi.doMock("../rest.ts", () => ({
      takGetText: () => new Promise<string>((resolve) => (answer = resolve)),
    }));
    const { knowParent, knownParents, refreshParent } = await import("./hierarchy.ts");
    const stale = refreshParent("north");
    knowParent("north", "op");
    answer(JSON.stringify({ data: { name: "old" } }));
    await stale;
    expect(knownParents().get("north")).toBe("op");
    vi.doUnmock("../rest.ts");
  });
});
