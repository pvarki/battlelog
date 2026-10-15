import { expect, test } from "vitest";
import {
  actionFor,
  assign,
  bindingOf,
  formatBinding,
  isReserved,
  keymapOf,
  resetAction,
} from "./bindings.ts";

const press = (
  key: string,
  mods: Partial<Record<"ctrl" | "meta" | "alt" | "shift", boolean>> = {},
) =>
  bindingOf({
    key,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  });

test("a press becomes a binding; Shift counts only with letters", () => {
  expect(press("M", { shift: true })).toBe("shift+m");
  expect(press("m")).toBe("m");
  expect(press("/", { shift: true })).toBe("/"); // Shift-7 on a Finnish keyboard
  expect(press("?", { shift: true })).toBe("?");
  expect(press("z", { ctrl: true })).toBe("mod+z");
  expect(press("z", { meta: true })).toBe("mod+z");
  expect(press("ö")).toBe("ö");
  expect(press("Shift", { shift: true })).toBeUndefined();
});

test("the viewer's changes win over the defaults", () => {
  const keymap = keymapOf({ laser: ["p"], centre: [] });
  expect(actionFor(keymap, "p")).toBe("laser");
  expect(actionFor(keymap, "l")).toBeUndefined();
  expect(actionFor(keymap, "c")).toBeUndefined();
  expect(actionFor(keymap, "mod+k")).toBe("commandBar");
});

test("taking a key from another action unbinds it there", () => {
  const { overrides, takenFrom } = assign({}, keymapOf({}), "laser", "m");
  expect(takenFrom).toBe("draw.marker");
  expect(keymapOf(overrides).get("draw.marker")).toEqual([]);
  expect(actionFor(keymapOf(overrides), "m")).toBe("laser");
});

test("keeping a second key when one of two is taken", () => {
  const { overrides } = assign({}, keymapOf({}), "laser", "mod+k");
  expect(keymapOf(overrides).get("commandBar")).toEqual(["/"]);
});

test("bindings read the way the platform writes them", () => {
  expect(formatBinding("mod+z", true)).toBe("⌘ Z");
  expect(formatBinding("mod+z", false)).toBe("Ctrl Z");
  expect(formatBinding("shift+m", false)).toBe("Shift M");
  expect(formatBinding("/", false)).toBe("/");
});

test("Shift stays on named keys, so Shift-Space and Space differ", () => {
  expect(press(" ", { shift: true })).toBe("shift+space");
  expect(press("ArrowUp", { shift: true })).toBe("shift+ArrowUp");
  expect(press(" ")).toBe("space");
});

test("the map's own keys can't be taken", () => {
  expect(isReserved("ArrowUp")).toBe(true);
  expect(isReserved("shift+ArrowLeft")).toBe(true);
  expect(isReserved("+")).toBe(true);
  expect(isReserved("mod+=")).toBe(true);
  expect(isReserved("m")).toBe(false);
});

test("resetting an action takes its default key back", () => {
  const taken = assign({}, keymapOf({}), "laser", "m").overrides;
  const reset = resetAction(taken, keymapOf(taken), "draw.marker");
  expect(actionFor(keymapOf(reset), "m")).toBe("draw.marker");
  expect(keymapOf(reset).get("laser")).toEqual([]);
});

test("a malformed override falls back to the default", () => {
  const keymap = keymapOf({ laser: 123, centre: ["x", 4] } as unknown as Record<string, string[]>);
  expect(keymap.get("laser")).toEqual(["l"]);
  expect(keymap.get("centre")).toEqual(["c"]);
});
