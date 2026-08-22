import { expect, test } from "vitest";
import descriptor, { buildEvent, type FormConfig, missingRequired } from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("a full form config validates", () => {
  const config = {
    title: "Spot report",
    reportType: "spotrep",
    submitLabel: "Send",
    fields: [
      { id: "f1", kind: "event", field: "header", required: true },
      { id: "f2", kind: "event", field: "eventTime" },
      { id: "f3", kind: "event", field: "locationPoint" },
      { id: "f4", kind: "data", label: "Enemy strength", input: "number", options: [] },
      { id: "f5", kind: "data", label: "Activity", input: "select", options: ["moving", "static"] },
      { id: "f6", kind: "fixed", target: "tags", value: "recon" },
      { id: "f7", kind: "fixed", target: "data", key: "team", value: "alpha" },
    ],
  };
  expect(descriptor.configSchema.safeParse(config).success).toBe(true);
});

test("bad field kinds and inputs are rejected", () => {
  expect(
    descriptor.configSchema.safeParse({
      reportType: "x",
      fields: [{ id: "f1", kind: "event", field: "nope" }],
    }).success,
  ).toBe(false);
  expect(
    descriptor.configSchema.safeParse({
      reportType: "x",
      fields: [{ id: "f1", kind: "data", label: "a", input: "radio", options: [] }],
    }).success,
  ).toBe(false);
});

// Mid-edit states from the config editor must validate: DashboardPage swaps in
// defaultConfig (wiping the form) whenever the stored config fails the schema.
test("configs the editor produces mid-edit validate", () => {
  expect(
    descriptor.configSchema.safeParse({
      reportType: "",
      fields: [
        { id: "f1", kind: "fixed", target: "tags", value: "" },
        { id: "f2", kind: "fixed", target: "data", key: "", value: "" },
        { id: "f3", kind: "data", label: "", input: "text", options: [] },
      ],
    }).success,
  ).toBe(true);
});

test("buildEvent skips empty fixed values and falls back for an empty reportType", () => {
  const payload = buildEvent(
    {
      reportType: "",
      fields: [
        { id: "f1", kind: "fixed", target: "tags", value: "" },
        { id: "f2", kind: "fixed", target: "data", key: "k", value: "" },
      ],
    },
    {},
  );
  expect(payload.type).toBe("form-report");
  expect(payload.header).toBe("report");
  expect(payload.tags).toBeUndefined();
  expect(payload.data).toBeUndefined();
});

const config: FormConfig = {
  title: "Spot report",
  reportType: "spotrep",
  fields: [
    { id: "h", kind: "event", field: "header", required: true },
    { id: "t", kind: "event", field: "eventTime" },
    { id: "g", kind: "event", field: "tags" },
    { id: "p", kind: "event", field: "locationPoint" },
    { id: "r", kind: "event", field: "admiraltyReliability" },
    { id: "n", kind: "data", label: "Enemy strength", input: "number", options: [] },
    { id: "c", kind: "data", label: "Confirmed?", input: "checkbox", options: [] },
    { id: "ft", kind: "fixed", target: "tags", value: "recon" },
    { id: "fd", kind: "fixed", target: "data", key: "team", value: "alpha" },
  ],
};

test("buildEvent assembles the payload", () => {
  const payload = buildEvent(config, {
    h: "Contact at bridge",
    t: "2026-08-22T14:30",
    g: ["urgent", "recon"],
    p: { lat: 60.2, lng: 24.9 },
    r: "B",
    n: 12,
    c: true,
  });
  expect(payload.type).toBe("form-spotrep");
  expect(payload.header).toBe("Contact at bridge");
  expect(payload.eventTime).toBe(new Date("2026-08-22T14:30").toISOString());
  expect(payload.tags).toEqual(["urgent", "recon"]);
  expect(payload.locationPoint).toEqual({ lat: 60.2, lng: 24.9 });
  expect(payload.admiraltyReliability).toBe("B");
  expect(payload.data).toEqual({ "enemy-strength": 12, confirmed: true, team: "alpha" });
});

test("buildEvent omits empty values and falls back to title for the header", () => {
  const payload = buildEvent(config, { g: [], p: { lat: 60.2 } });
  expect(payload.header).toBe("Spot report");
  expect(payload.eventTime).toBeUndefined();
  expect(payload.locationPoint).toBeUndefined();
  expect(payload.tags).toEqual(["recon"]);
  expect(payload.data).toEqual({ team: "alpha" });
});

test("header falls back to reportType without a title", () => {
  const payload = buildEvent({ reportType: "casevac", fields: [] }, {});
  expect(payload.header).toBe("casevac");
  expect(payload.type).toBe("form-casevac");
});

// The API rejects an empty header, so buildEvent must always produce one.
test("header precedence: typed value, then fixed header, then title, then reportType", () => {
  const input: FormConfig["fields"][number] = { id: "h", kind: "event", field: "header" };
  const fixed: FormConfig["fields"][number] = {
    id: "fh",
    kind: "fixed",
    target: "header",
    value: "Contact report",
  };
  const fields = [input, fixed];
  expect(buildEvent({ title: "T", reportType: "r", fields }, { h: "Typed" }).header).toBe("Typed");
  expect(buildEvent({ title: "T", reportType: "r", fields }, {}).header).toBe("Contact report");
  expect(buildEvent({ title: "T", reportType: "r", fields: [input] }, {}).header).toBe("T");
  expect(buildEvent({ title: "  ", reportType: "casevac", fields: [] }, {}).header).toBe("casevac");
});

test("a fixed header is not written into the data blob", () => {
  const payload = buildEvent(
    {
      reportType: "r",
      fields: [{ id: "fh", kind: "fixed", target: "header", key: "stray", value: "Contact" }],
    },
    {},
  );
  expect(payload.header).toBe("Contact");
  expect(payload.data).toBeUndefined();
});

test("an explicit data key wins over the slugified label", () => {
  const payload = buildEvent(
    {
      reportType: "x",
      fields: [
        {
          id: "a",
          kind: "data",
          label: "Enemy strength",
          key: "pax",
          input: "number",
          options: [],
        },
        { id: "b", kind: "data", label: "Enemy strength", key: "  ", input: "text", options: [] },
      ],
    },
    { a: 12, b: "reserve" },
  );
  expect(payload.data).toEqual({ pax: 12, "enemy-strength": "reserve" });
});

test("custom labels override the built-in event field names", () => {
  const strict: FormConfig = {
    reportType: "x",
    fields: [
      { id: "h", kind: "event", field: "header", label: "Callsign", required: true },
      { id: "p", kind: "event", field: "locationPoint", label: "  ", required: true },
    ],
  };
  expect(missingRequired(strict, {})).toEqual([
    { id: "h", label: "Callsign" },
    { id: "p", label: "Coordinates" },
  ]);
});

test("missingRequired reports empty required fields", () => {
  const strict: FormConfig = {
    reportType: "x",
    fields: [
      { id: "h", kind: "event", field: "header", required: true },
      { id: "p", kind: "event", field: "locationPoint", required: true },
      {
        id: "c",
        kind: "data",
        label: "Confirmed?",
        input: "checkbox",
        options: [],
        required: true,
      },
      { id: "ft", kind: "fixed", target: "tags", value: "recon" },
    ],
  };
  expect(missingRequired(strict, { p: { lat: 1 }, c: false })).toEqual([
    { id: "h", label: "Header" },
    { id: "p", label: "Coordinates" },
    { id: "c", label: "Confirmed?" },
  ]);
  expect(missingRequired(strict, { h: "x", p: { lat: 1, lng: 2 }, c: true })).toEqual([]);
});
