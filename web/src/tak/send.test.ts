// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { toChange } from "./cot.ts";
import { addressedEvent } from "./send.ts";

const change = toChange({
  uid: "hostile-1",
  type: "a-h-G",
  how: "h-g-i-g-o",
  time: 1_000,
  start: 1_000,
  stale: 2_000,
  lat: 60.4,
  lon: 22.2,
  hae: 0,
  ce: 0,
  le: 0,
  detail:
    '<contact callsign="Vihollinen 1"/><marti><dest callsign="Old"/></marti><plugin_extension x="1"><nested a="b"/></plugin_extension>',
});
if (change?.kind !== "upsert") throw new Error("expected upsert");
const item = change.item;

test("a sent item reaches only the chosen callsigns, re-issued now with its detail intact", () => {
  const sent = addressedEvent(item, ["Eetu", "Kilo & 15"], 5_000);
  expect(sent).toMatchObject({ uid: "hostile-1", type: "a-h-G", time: 5_000, start: 5_000 });
  expect(sent.stale).toBeGreaterThan(5_000);
  expect(sent.detail).toContain(
    '<marti><dest callsign="Eetu"/><dest callsign="Kilo &amp; 15"/></marti>',
  );
  expect(sent.detail).not.toContain("Old");
  expect(sent.detail).toContain('<contact callsign="Vihollinen 1"/>');
  expect(sent.detail).toContain('<plugin_extension x="1"><nested a="b"/></plugin_extension>');
});
