import { describe, expect, it } from "vitest";
import type { Widget } from "../api.ts";
import { mobileWidgets, withWidgetConfig } from "./mobile.ts";

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

  it("flattens tabs into their mobile-visible children, in the parent's slot", () => {
    const layout = { x: 4, y: 2, w: 16, h: 12 };
    const note = { id: "n", type: "note", config: {} };
    const hidden = { id: "h", type: "clock", config: { showOnMobile: false } };
    const table = { id: "t", type: "table", config: {} };
    const tabs = widget({ type: "tabs", layout, config: { tabs: [note, hidden, table] } });
    const before = widget({ layout: { x: 0, y: 0, w: 4, h: 4 } });
    expect(mobileWidgets([tabs, before])).toEqual([
      before,
      { ...note, id: `${tabs.id}/n`, layout },
    ]);
  });

  it("keeps an invalid tabs widget whole so its placeholder shows", () => {
    const broken = widget({ type: "tabs", config: { tabs: "nope" } });
    expect(mobileWidgets([broken])).toEqual([broken]);
  });
});

describe("withWidgetConfig", () => {
  it("writes a child's config into its tabs parent", () => {
    const other = widget({});
    const tabs = widget({
      type: "tabs",
      config: { title: "Ops", tabs: [{ id: "n", type: "note", config: {} }] },
    });
    const duplicate = { ...tabs, id: "dup" };
    const next = withWidgetConfig([other, tabs, duplicate], `${tabs.id}/n`, { eventId: "e1" });
    expect(next[0]).toBe(other);
    expect(next[1]?.config).toEqual({
      title: "Ops",
      tabs: [{ id: "n", type: "note", config: { eventId: "e1" } }],
    });
    expect(next[2]).toBe(duplicate);
  });

  it("writes a top-level widget's config directly", () => {
    const w = widget({});
    expect(withWidgetConfig([w], w.id, { title: "x" })[0]?.config).toEqual({ title: "x" });
  });
});
