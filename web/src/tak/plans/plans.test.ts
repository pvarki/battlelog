// @vitest-environment happy-dom
import { unzipSync, zipSync } from "fflate";
import { expect, test } from "vitest";
import type { CotEvent } from "../cot.ts";
import { parseCotXml, serializeCot } from "../protocol/cot-xml.ts";
import {
  addToPlan,
  createPlan,
  draftOf,
  editPlan,
  exportPlan,
  importPlan,
  missionChanges,
} from "./plans.ts";

const sender = { uid: "BattleLog-Eversti", callsign: "Eversti" };

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
  expect(Object.keys(files).sort()).toEqual(["0-draft-1/0-draft-1.cot", "MANIFEST/manifest.xml"]);
  const imported = await importPlan(
    [new File([await exported.arrayBuffer()], "Hyökkäys.zip")],
    sender,
  );
  expect(imported.name).toBe("Hyökkäys");
  expect(imported.entries.map((e) => e.event)).toEqual([event]);
});

test("hostile uids and names can't escape the package or break its manifest", async () => {
  const evil = { ...event, uid: '../../evil" x="1' };
  const plan = createPlan('A "plan" <x>');
  const files = unzipSync(
    new Uint8Array(await exportPlan({ ...plan, entries: [{ event: evil }] }).arrayBuffer()),
  );
  expect(Object.keys(files).every((path) => !path.includes("..") && !path.startsWith("/"))).toBe(
    true,
  );
  const manifest = new TextDecoder().decode(files["MANIFEST/manifest.xml"]);
  expect(manifest).toContain('value="../../evil&quot; x=&quot;1"');
  expect(manifest).toContain('value="A &quot;plan&quot; &lt;x&gt;"');
});

test("importing keeps map items and drops deletes and other control messages", async () => {
  const del: CotEvent = {
    ...event,
    uid: "del-1",
    type: "t-x-d-d",
    detail: '<link uid="victim" relation="none"/>',
  };
  const plan = createPlan("mixed");
  const blob = exportPlan({ ...plan, entries: [{ event }, { event: del }] });
  const imported = await importPlan([new File([await blob.arrayBuffer()], "mixed.zip")], sender);
  expect(imported.entries.map((e) => e.event.uid)).toEqual(["draft-1"]);
});

test("drafts join a mission and staged deletes leave it only when they were in it", () => {
  const deleteOf = (uid: string): CotEvent => ({
    ...event,
    uid,
    type: "t-x-d-d",
    detail: `<link uid="${uid}" relation="none"/><__forcedelete/>`,
  });
  const entries = [{ event }, { event: deleteOf("in-mission") }, { event: deleteOf("elsewhere") }];
  expect(missionChanges(entries, ["in-mission"])).toEqual({
    add: ["draft-1"],
    remove: ["in-mission"],
  });
});

test("a package whose CoT expands past the limit is refused", async () => {
  const big = new Uint8Array(2 * 1_048_576);
  const zip = zipSync({ "a/a.cot": big, "notes.txt": big });
  await expect(importPlan([new File([zip.slice()], "big.zip")], sender)).rejects.toThrow(
    /too large/,
  );
});

const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>OP</name><Point><coordinates>22.2,60.4</coordinates></Point></Placemark></Document></kml>`;

test("a KMZ imports as a plan of its KML's drawings", async () => {
  const kmz = zipSync({ "doc.kml": new TextEncoder().encode(kml) });
  const plan = await importPlan([new File([kmz.slice()], "Alue.kmz")], sender);
  expect(plan.name).toBe("Alue");
  expect(plan.entries.map((e) => e.event.type)).toEqual(["b-m-p-s-m"]);
});

test("a KMZ whose KML expands past the limit is refused", async () => {
  const kmz = zipSync({ "doc.kml": new Uint8Array(51 * 1_048_576) });
  await expect(importPlan([new File([kmz.slice()], "big.kmz")], sender)).rejects.toThrow(
    /too large/,
  );
});

test("a group edit adds, replaces and removes drafts at once, keeping each item's first base", () => {
  const plan = createPlan("group");
  const at = (uid: string, time: number) => ({ ...event, uid, time });
  addToPlan(plan, { event: at("a", 1), basedOn: 100 });
  addToPlan(plan, { event: at("b", 1) });
  editPlan(plan, {
    add: [{ event: at("a", 2), basedOn: 200 }, { event: at("c", 2) }],
    remove: ["b"],
  });
  expect(draftOf(plan, "a")).toEqual({ event: at("a", 2), basedOn: 100 });
  expect(draftOf(plan, "b")).toBeUndefined();
  expect(draftOf(plan, "c")?.event.time).toBe(2);
});
