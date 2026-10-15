import { expect, test } from "vitest";
import { type Command, rank, remember, score } from "./commands.ts";

const command = (
  label: string,
  group: Command["group"],
  extra: Partial<Command> = {},
): Command => ({
  id: label,
  label,
  group,
  run: () => {},
  ...extra,
});

test("a label's start beats a word's start beats anywhere, then keywords and detail", () => {
  expect(score(command("Measure", "Draw"), "mea")).toBe(0);
  expect(score(command("Show MGRS grid", "Map"), "mgrs")).toBe(1);
  expect(score(command("Bullseye", "Draw"), "eye")).toBe(2);
  expect(score(command("Range rings", "Draw", { keywords: ["distance"] }), "dist")).toBe(3);
  expect(score(command("V1", "Items", { detail: "Hostile ground unit" }), "hostile")).toBe(4);
  expect(score(command("Measure", "Draw"), "xyz")).toBeUndefined();
});

test("groups come in their fixed order, best match first in each", () => {
  const ranked = rank(
    [
      command("Show tracks", "Map"),
      command("Tracks", "Map"),
      command("Track 7", "Items"),
      command("Plans", "Go to"),
    ],
    "track",
  );
  expect(ranked.map((g) => g.group)).toEqual(["Items", "Map"]);
  expect(ranked[1]?.commands.map((c) => c.label)).toEqual(["Tracks", "Show tracks"]);
});

test("an empty query lists everything, capped per group", () => {
  const many = Array.from({ length: 12 }, (_, i) => command(`Feed ${i}`, "Data Sync feeds"));
  expect(rank(many, "", 8)[0]?.commands).toHaveLength(8);
});

test("recents move to the front without repeating", () => {
  expect(remember(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  expect(remember(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
});
