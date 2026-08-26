import { describe, expect, test } from "vitest";
import type { EventResponse } from "../../api.ts";
import descriptor, {
  activeFilters,
  columnWidth,
  dataValue,
  labelFor,
  matchesFeed,
  queryFor,
} from "./widget.ts";

test("defaultConfig validates against configSchema", () => {
  expect(descriptor.configSchema.safeParse(descriptor.defaultConfig).success).toBe(true);
});

test("schema migrates legacy string columns to column objects", () => {
  const parsed = descriptor.configSchema.safeParse({ columns: ["time", "header"] });
  expect(parsed.success && parsed.data.columns).toEqual([
    { id: "time", label: "", source: "time", dataPath: "" },
    { id: "header", label: "", source: "header", dataPath: "" },
  ]);
});

test("schema applies defaults and rejects bad columns", () => {
  const parsed = descriptor.configSchema.safeParse({});
  expect(parsed.success && parsed.data.rows).toBe(10);
  expect(parsed.success && parsed.data.columns.map((c) => c.source)).toEqual([
    "time",
    "header",
    "type",
  ]);
  expect(descriptor.configSchema.safeParse({ columns: [] }).success).toBe(false);
  expect(descriptor.configSchema.safeParse({ columns: ["location"] }).success).toBe(false);
});

test("schema accepts bounded column widths", () => {
  expect(
    descriptor.configSchema.safeParse({
      columns: [{ id: "header", label: "", source: "header", dataPath: "", width: 240 }],
    }).success,
  ).toBe(true);
  expect(
    descriptor.configSchema.safeParse({
      columns: [{ id: "header", label: "", source: "header", dataPath: "", width: 20 }],
    }).success,
  ).toBe(false);
});

test("columnWidth defaults to the visible header text width until overridden", () => {
  expect(columnWidth({ id: "time", label: "", source: "time", dataPath: "" })).toBe(72);
  expect(columnWidth({ id: "header", label: "", source: "header", dataPath: "" })).toBe(80);
  expect(columnWidth({ id: "desk", label: "Desk", source: "data", dataPath: "desk" })).toBe(72);
  expect(
    columnWidth({
      id: "event-time",
      label: "Tapahtuma-ajankohta",
      source: "data",
      dataPath: "time",
    }),
  ).toBe(184);
  expect(columnWidth({ id: "header", label: "", source: "header", dataPath: "", width: 260 })).toBe(
    260,
  );
});

test("dataValue resolves dot paths and blanks missing or non-scalar values", () => {
  const data = { casualties: { total: 3, list: [1, 2] }, ok: false, note: "hi" };
  expect(dataValue(data, "note")).toBe("hi");
  expect(dataValue(data, "casualties.total")).toBe("3");
  expect(dataValue(data, "ok")).toBe("false");
  expect(dataValue(data, "casualties")).toBe("");
  expect(dataValue(data, "casualties.list")).toBe("");
  expect(dataValue(data, "missing.path")).toBe("");
  expect(dataValue(null, "anything")).toBe("");
});

test("labelFor prefers explicit label, then field label, then data path tail", () => {
  expect(labelFor({ id: "1", label: "Custom", source: "time", dataPath: "" })).toBe("Custom");
  expect(labelFor({ id: "2", label: "", source: "time", dataPath: "" })).toBe("Time");
  expect(labelFor({ id: "3", label: "", source: "data", dataPath: "casualties.total" })).toBe(
    "total",
  );
  expect(labelFor({ id: "4", label: "", source: "data", dataPath: "" })).toBe("Data");
});

const base = descriptor.defaultConfig;
const row = (over: Partial<EventResponse>): EventResponse =>
  ({
    header: "Contact at bridge",
    type: "foe-movement",
    tags: ["1.K"],
    createdBy: "cn",
    eventTime: "2026-08-20T10:00:00.000Z",
    createdAt: "2026-08-20T11:00:00.000Z",
    ...over,
  }) as EventResponse;

test("matchesFeed mirrors the query semantics", () => {
  expect(matchesFeed(row({}), base)).toBe(true);
  expect(matchesFeed(row({}), { ...base, types: ["foe-movement"] })).toBe(true);
  expect(matchesFeed(row({ type: null }), { ...base, types: ["foe-movement"] })).toBe(false);
  expect(matchesFeed(row({}), { ...base, tags: ["2.K", "1.K"] })).toBe(true);
  expect(matchesFeed(row({ tags: null }), { ...base, tags: ["1.K"] })).toBe(false);
  expect(matchesFeed(row({}), { ...base, search: "AT BRIDGE" })).toBe(true);
  expect(matchesFeed(row({}), { ...base, search: "mortar" })).toBe(false);
  expect(matchesFeed(row({}), { ...base, createdBy: "someone-else" })).toBe(false);
});

test("matchesFeed extras narrow on top of config filters", () => {
  const config = { ...base, types: ["foe-movement", "own-movement"], tags: ["1.K"] };
  // extras narrow types within the config set
  expect(matchesFeed(row({}), config, { types: ["foe-movement"] })).toBe(true);
  expect(matchesFeed(row({}), config, { types: ["own-movement"] })).toBe(false);
  // extra tags are a second any-of group ANDed with the config's
  expect(matchesFeed(row({ tags: ["1.K", "2.K"] }), config, { tags: ["2.K"] })).toBe(true);
  expect(matchesFeed(row({}), config, { tags: ["2.K"] })).toBe(false);
  // extra search and createdBy apply alongside config
  expect(matchesFeed(row({}), base, { search: "bridge" })).toBe(true);
  expect(matchesFeed(row({}), base, { search: "mortar" })).toBe(false);
  expect(matchesFeed(row({}), base, { createdBy: "cn" })).toBe(true);
  expect(matchesFeed(row({}), base, { createdBy: "other" })).toBe(false);
});

test("matchesFeed extras filter on time ranges", () => {
  // datetime-local strings parse as local time; use explicit offsets here to stay hermetic
  expect(matchesFeed(row({}), base, { eventTimeFrom: "2026-08-20T09:00Z" })).toBe(true);
  expect(matchesFeed(row({}), base, { eventTimeFrom: "2026-08-20T12:00Z" })).toBe(false);
  expect(matchesFeed(row({}), base, { eventTimeTo: "2026-08-20T09:00Z" })).toBe(false);
  // rows without an eventTime are excluded when an eventTime bound is set
  expect(matchesFeed(row({ eventTime: null }), base, { eventTimeFrom: "2026-08-20T09:00Z" })).toBe(
    false,
  );
  expect(matchesFeed(row({}), base, { createdAtFrom: "2026-08-20T10:30Z" })).toBe(true);
  expect(matchesFeed(row({}), base, { createdAtTo: "2026-08-20T10:30Z" })).toBe(false);
});

test("queryFor emits csv params and omits empty filters", () => {
  expect(queryFor(base)).toEqual({});
  expect(queryFor({ ...base, types: ["a", "b"], tags: ["x"], search: "s" })).toEqual({
    types: "a,b",
    tags: "x",
    search: "s",
  });
});

test("queryFor sends config filters plus extras' time ranges and gap-fillers", () => {
  // config filters stay authoritative server-side; extras narrow client-side,
  // except time ranges (extras-only) and search/createdBy when config left them empty
  expect(
    queryFor({ ...base, types: ["a"], search: "cfg" }, { types: ["b"], search: "extra" }),
  ).toEqual({ types: "a", search: "cfg" });
  expect(queryFor(base, { search: "extra", createdBy: "cn" })).toEqual({
    search: "extra",
    createdBy: "cn",
  });
  expect(
    queryFor(base, { eventTimeFrom: "2026-08-20T09:00", createdAtTo: "2026-08-21T00:00" }),
  ).toEqual({
    eventTimeFrom: "2026-08-20T09:00",
    createdAtTo: "2026-08-21T00:00",
  });
});

/** A config as the schema would produce it, with only these fields set. */
const cfg = (over: Record<string, unknown>) =>
  descriptor.configSchema.parse({ ...descriptor.defaultConfig, ...over });

describe("activeFilters", () => {
  test("says nothing when the widget filters nothing", () => {
    expect(activeFilters(cfg({}))).toEqual([]);
  });

  test("names each filter, so an impossible combination is visible", () => {
    // The case that prompted this: a template feed filtered to a type nothing
    // produces, where changing ingest settings could never help.
    expect(activeFilters(cfg({ types: ["form-report"] }))).toEqual(["type: form-report"]);
    expect(
      activeFilters(
        cfg({ types: ["form-report"], ingestSources: ["01920000-0000-7000-8000-0000000000aa"] }),
      ),
    ).toEqual(["type: form-report", "one ingest setup"]);
  });
});
