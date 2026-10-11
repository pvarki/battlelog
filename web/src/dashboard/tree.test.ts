import { describe, expect, it } from "vitest";
import { buildTree } from "./tree.ts";

describe("buildTree", () => {
  it("nests by path, folders first, natural order", () => {
    const tree = buildTree([
      { id: "1", name: "Ops/Medical/Triage" },
      { id: "2", name: "Overview" },
      { id: "3", name: "Ops/Shift 10" },
      { id: "4", name: "Ops/Shift 2" },
      { id: "5", name: " Ops / Medical / Evac " },
    ]);
    expect(tree).toEqual([
      {
        kind: "folder",
        name: "Ops",
        path: "Ops",
        children: [
          {
            kind: "folder",
            name: "Medical",
            path: "Ops/Medical",
            children: [
              { kind: "item", name: "Evac", id: "5" },
              { kind: "item", name: "Triage", id: "1" },
            ],
          },
          { kind: "item", name: "Shift 2", id: "4" },
          { kind: "item", name: "Shift 10", id: "3" },
        ],
      },
      { kind: "item", name: "Overview", id: "2" },
    ]);
  });

  it("keeps a name made only of slashes as a top-level item", () => {
    expect(buildTree([{ id: "1", name: "//" }])).toEqual([{ kind: "item", name: "//", id: "1" }]);
  });
});
