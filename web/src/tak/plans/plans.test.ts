// @vitest-environment happy-dom
import { unzipSync } from "fflate";
import { expect, test } from "vitest";
import type { CotEvent } from "../cot.ts";
import { parseCotXml, serializeCot } from "../protocol/cot-xml.ts";
import { addToPlan, createPlan, exportPlan, importPlan } from "./plans.ts";

const event: CotEvent = {
  uid: "draft-1",
  type: "u-d-f",
  how: "h-e",
  time: Date.parse("2026-10-13T10:00:00Z"),
  start: Date.parse("2026-10-13T10:00:00Z"),
  stale: Date.parse("2026-10-14T10:00:00Z"),
  lat: 60.4,
  lon: 22.2,
  hae: 9999999,
  ce: 9999999,
  le: 9999999,
  access: "Undefined",
  detail:
    '<contact callsign="Etulinja &amp; reuna"/><link point="60.4,22.2"/><link point="60.5,22.3"/><archive/>',
};

test("a CoT event survives serialising and parsing back", () => {
  expect(parseCotXml(serializeCot(event))).toEqual([event]);
});

test("a plan exports as an ATAK data package and imports back as the same drafts", async () => {
  const plan = createPlan("Hyökkäys");
  addToPlan(plan, { event });
  const exported = exportPlan({ ...plan, entries: [{ event }] });
  const files = unzipSync(new Uint8Array(await exported.arrayBuffer()));
  expect(Object.keys(files).sort()).toEqual(["MANIFEST/manifest.xml", "draft-1/draft-1.cot"]);
  const imported = await importPlan(new File([await exported.arrayBuffer()], "Hyökkäys.zip"));
  expect(imported.name).toBe("Hyökkäys");
  expect(imported.entries.map((e) => e.event)).toEqual([event]);
});
