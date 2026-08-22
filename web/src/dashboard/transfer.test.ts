import { expect, test } from "vitest";
import type { DashboardResponse } from "../api.ts";
import { exportFilename, parseDashboardImport, toExportJson } from "./transfer.ts";

const dashboard: DashboardResponse = {
  id: "018f0000-0000-7000-8000-000000000001",
  name: "Recon North",
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

test("export drops identity and history, keeps name/isTemplate/widgets", () => {
  expect(JSON.parse(toExportJson(dashboard))).toEqual({
    name: "Recon North",
    isTemplate: false,
    widgets: dashboard.widgets,
  });
});

test("export round-trips through import", () => {
  const parsed = parseDashboardImport(toExportJson(dashboard));
  expect(parsed).toEqual({
    ok: true,
    value: { name: "Recon North", isTemplate: false, widgets: dashboard.widgets },
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
    value: { name: "x", isTemplate: false, widgets: [] },
  });
  expect(parseDashboardImport('{"name":"x","isTemplate":true,"widgets":[]}')).toEqual({
    ok: true,
    value: { name: "x", isTemplate: true, widgets: [] },
  });
});

test("filename slugifies, with a fallback for names that slugify to nothing", () => {
  expect(exportFilename("Recon North")).toBe("recon-north.dashboard.json");
  expect(exportFilename("!!!")).toBe("dashboard.dashboard.json");
});
