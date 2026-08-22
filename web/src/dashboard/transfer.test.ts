import { expect, test } from "vitest";
import type { DashboardResponse } from "../api.ts";
import { exportFilename, forkWidgets, parseDashboardImport, toExportJson } from "./transfer.ts";

const L = { x: 0, y: 0, w: 4, h: 4 };

const dashboard: DashboardResponse = {
  id: "018f0000-0000-7000-8000-000000000001",
  name: "Recon North",
  description: "Northern sector — patrol reports and sensor status",
  isTemplate: false,
  widgets: [
    {
      id: "w1",
      type: "todo",
      config: { eventId: "018f0000-0000-7000-8000-0000000000aa" },
      layout: { x: 0, y: 0, w: 8, h: 8 },
    },
  ],
  templateEvents: [],
  version: "018f0000-0000-7000-8000-000000000002",
  createdBy: "CN=alice",
  updatedBy: null,
  createdAt: "2026-08-22T10:00:00.000Z",
  updatedAt: "2026-08-22T10:00:00.000Z",
};

test("export drops identity, history, and every widget's event pointer", () => {
  expect(JSON.parse(toExportJson(dashboard))).toEqual({
    name: "Recon North",
    description: dashboard.description,
    isTemplate: false,
    widgets: [{ ...dashboard.widgets[0], config: {} }],
  });
});

test("forkWidgets clears eventId so a copy starts its own chain", () => {
  const widgets = [
    { id: "a", type: "note", config: { eventId: "e1", title: "kept" }, layout: L },
    { id: "b", type: "clock", config: { tz: "UTC" }, layout: L },
    { id: "c", type: "todo", config: null, layout: L },
    { id: "d", type: "note", layout: L },
  ];
  expect(forkWidgets(widgets)).toEqual([
    { id: "a", type: "note", config: { title: "kept" }, layout: L },
    { id: "b", type: "clock", config: { tz: "UTC" }, layout: L },
    { id: "c", type: "todo", config: null, layout: L },
    { id: "d", type: "note", layout: L },
  ]);
  // The source must not be mutated: the caller still renders it.
  expect(widgets[0]?.config).toEqual({ eventId: "e1", title: "kept" });
});

test("export round-trips through import", () => {
  const parsed = parseDashboardImport(toExportJson(dashboard));
  expect(parsed).toEqual({
    ok: true,
    value: {
      name: "Recon North",
      description: dashboard.description,
      isTemplate: false,
      widgets: [{ ...dashboard.widgets[0], config: {} }],
    },
  });
});

test("templateEvents are accepted but not required in imports", () => {
  const templateEvents = [{ widgetId: "w1", header: "Initial todo", type: "todo", data: [] }];
  expect(
    parseDashboardImport(
      JSON.stringify({
        name: "Template",
        isTemplate: true,
        widgets: dashboard.widgets,
        templateEvents,
      }),
    ),
  ).toEqual({
    ok: true,
    value: { name: "Template", isTemplate: true, widgets: dashboard.widgets, templateEvents },
  });
  expect(parseDashboardImport('{"name":"Plain","widgets":[]}')).toEqual({
    ok: true,
    value: { name: "Plain", isTemplate: false, widgets: [] },
  });
});

test("import names what is wrong instead of posting garbage", () => {
  expect(parseDashboardImport("{oops")).toEqual({ ok: false, error: "Not valid JSON" });
  expect(parseDashboardImport("[]").ok).toBe(false);
  expect(parseDashboardImport("null").ok).toBe(false);
  expect(parseDashboardImport('"a string"').ok).toBe(false);
  expect(parseDashboardImport('{"widgets":[]}').ok).toBe(false);
  expect(parseDashboardImport('{"name":"  ","widgets":[]}').ok).toBe(false);
  expect(parseDashboardImport('{"name":"x"}').ok).toBe(false);
  expect(parseDashboardImport('{"name":"x","widgets":{}}').ok).toBe(false);
  expect(parseDashboardImport('{"name":"x","widgets":[],"templateEvents":{}}').ok).toBe(false);
});

test("import trims the name and defaults a missing isTemplate to false", () => {
  expect(parseDashboardImport('{"name":" x ","widgets":[]}')).toEqual({
    ok: true,
    value: { name: "x", description: null, isTemplate: false, widgets: [] },
  });
  expect(parseDashboardImport('{"name":"x","isTemplate":true,"widgets":[]}')).toEqual({
    ok: true,
    value: { name: "x", description: null, isTemplate: true, widgets: [] },
  });
});

test("import normalises every flavour of absent description to null", () => {
  const description = (json: string) => {
    const parsed = parseDashboardImport(json);
    return parsed.ok ? parsed.value.description : "not parsed";
  };
  expect(description('{"name":"x","widgets":[]}')).toBe(null);
  expect(description('{"name":"x","description":null,"widgets":[]}')).toBe(null);
  expect(description('{"name":"x","description":"  ","widgets":[]}')).toBe(null);
  expect(description('{"name":"x","description":42,"widgets":[]}')).toBe(null);
  expect(description('{"name":"x","description":" kept ","widgets":[]}')).toBe("kept");
});

test("filename slugifies, with a fallback for names that slugify to nothing", () => {
  expect(exportFilename("Recon North")).toBe("recon-north.dashboard.json");
  expect(exportFilename("!!!")).toBe("dashboard.dashboard.json");
});
