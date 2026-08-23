import { describe, expect, it } from "vitest";
import type { Widget } from "../api.ts";
import { mobileWidgets } from "./mobile.ts";

const widget = (overrides: Partial<Widget>): Widget => ({
  id: crypto.randomUUID(),
  type: "clock",
  config: {},
  layout: { x: 0, y: 0, w: 8, h: 6 },
  ...overrides,
});

describe("mobileWidgets", () => {
  it("orders by reading order: y first, then x", () => {
    const bottom = widget({ layout: { x: 0, y: 10, w: 8, h: 6 } });
    const topRight = widget({ layout: { x: 20, y: 0, w: 8, h: 6 } });
    const topLeft = widget({ layout: { x: 0, y: 0, w: 8, h: 6 } });
    expect(mobileWidgets([bottom, topRight, topLeft])).toEqual([topLeft, topRight, bottom]);
  });

  it("excludes types flagged showOnMobile: false (table)", () => {
    const table = widget({ type: "table" });
    expect(mobileWidgets([table, widget({})])).toHaveLength(1);
  });

  it("excludes instances the user turned off, defaulting to shown", () => {
    const hidden = widget({ config: { showOnMobile: false } });
    const shown = widget({ config: { showOnMobile: true } });
    const unset = widget({ config: {} });
    expect(mobileWidgets([hidden, shown, unset])).toEqual([shown, unset]);
  });

  it("excludes unknown widget types", () => {
    expect(mobileWidgets([widget({ type: "nope" })])).toEqual([]);
  });
});
