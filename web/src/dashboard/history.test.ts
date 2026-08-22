import { describe, expect, it } from "vitest";
import type { Widget } from "../api.ts";
import { canRedo, canUndo, newHistory, record, step } from "./history.ts";

const snap = (name: string, ids: string[] = []) => ({
  name,
  widgets: ids.map((id) => ({ id }) as Widget),
});
const names = (h: ReturnType<typeof newHistory>) => h.entries.map((e) => e.name);

describe("dashboard history", () => {
  it("collapses a coalesced run into one entry, so undo reaches the original", () => {
    const h = newHistory(snap("start"));
    // A config form fires per keystroke: same key, so one undo step.
    record(h, snap("s"), "config:a");
    record(h, snap("so"), "config:a");
    record(h, snap("sol"), "config:a");
    expect(names(h)).toEqual(["start", "sol"]);
    expect(step(h, -1)?.name).toBe("start");
  });

  it("starts a new entry when the gesture changes", () => {
    const h = newHistory(snap("start"));
    record(h, snap("a"), "config:a");
    record(h, snap("b"), "config:b");
    record(h, snap("c"), null);
    expect(names(h)).toEqual(["start", "a", "b", "c"]);
  });

  it("re-pushes after a jump even under the same key, since the jump closed it", () => {
    const h = newHistory(snap("start"));
    record(h, snap("a"), "layout");
    step(h, -1);
    record(h, snap("b"), "layout");
    expect(names(h)).toEqual(["start", "b"]);
  });

  it("abandons the redo tail on a new edit", () => {
    const h = newHistory(snap("start"));
    record(h, snap("a"), null);
    record(h, snap("b"), null);
    step(h, -1); // back to "a"
    expect(canRedo(h)).toBe(true);
    record(h, snap("c"), null);
    expect(names(h)).toEqual(["start", "a", "c"]);
    expect(canRedo(h)).toBe(false);
  });

  it("walks back and forward over structural edits", () => {
    const h = newHistory(snap("start", []));
    record(h, snap("one", ["w1"]), null);
    record(h, snap("two", ["w1", "w2"]), null);
    expect(step(h, -1)?.widgets).toHaveLength(1);
    expect(step(h, -1)?.widgets).toHaveLength(0);
    expect(canUndo(h)).toBe(false);
    expect(step(h, -1)).toBeUndefined();
    expect(step(h, 1)?.widgets).toHaveLength(1);
  });

  it("caps depth and keeps the cursor on the newest entry", () => {
    const h = newHistory(snap("start"));
    for (let i = 0; i < 80; i++) record(h, snap(`s${i}`), null);
    expect(h.entries).toHaveLength(50);
    expect(h.cursor).toBe(49);
    expect(h.entries[h.cursor]?.name).toBe("s79");
    expect(canRedo(h)).toBe(false);
  });
});
