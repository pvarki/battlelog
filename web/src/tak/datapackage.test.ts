// @vitest-environment happy-dom
import { unzipSync } from "fflate";
import { expect, test } from "vitest";
import { toChange } from "./cot.ts";
import { attachmentPackage, fileShareEvent } from "./datapackage.ts";

const change = toChange({
  uid: "bl-test-hostile-1",
  type: "a-h-G-U-C-I",
  how: "h-g-i-g-o",
  time: 1,
  start: 1,
  stale: 2,
  lat: 60.4,
  lon: 22,
  hae: 0,
  ce: 0,
  le: 0,
  detail: '<contact callsign="Vihollisryhmä 1 &amp; co"/>',
});
if (change?.kind !== "upsert") throw new Error("expected upsert");
const item = change.item;

test("the package holds ATAK's manifest and the photo tied to the marker, not the marker itself", () => {
  const photo = new Uint8Array([1, 2, 3]);
  const files = unzipSync(attachmentPackage(item, "bda.jpg", photo));
  const names = Object.keys(files);
  expect(names).toHaveLength(2);
  const photoEntry = names.find((n) => n.endsWith("/bda.jpg")) as string;
  expect(files[photoEntry]).toEqual(photo);
  const manifest = new TextDecoder().decode(files["MANIFEST/manifest.xml"]);
  expect(manifest).toContain('<MissionPackageManifest version="2">');
  expect(manifest).toContain('<Parameter name="uid" value="bl-test-hostile-1"/>');
  expect(manifest).toContain('<Parameter name="callsign" value="Vihollisryhmä 1 &amp; co"/>');
  expect(manifest).toContain(
    `<Content ignore="false" zipEntry="${photoEntry}"><Parameter name="uid" value="bl-test-hostile-1"/></Content>`,
  );
  expect(names.some((n) => n.endsWith(".cot"))).toBe(false);
});

test("the file-share announcement goes to chosen callsigns, or to everyone without any", () => {
  const share = {
    fileName: "bda.zip",
    hash: "ab".repeat(32),
    size: 3,
    name: "Vihollisryhmä 1: bda.jpg",
  };
  const sender = { uid: "BattleLog-Eversti", callsign: "Eversti" };
  const toTwo = fileShareEvent(share, sender, ["Eetu", "Kilo15"], 1_000);
  expect(toTwo).toMatchObject({ type: "b-f-t-r", time: 1_000, stale: 101_000 });
  expect(toTwo.detail).toContain('<marti><dest callsign="Eetu"/><dest callsign="Kilo15"/></marti>');
  expect(toTwo.detail).toContain(`sha256="${"ab".repeat(32)}"`);
  expect(toTwo.detail).toContain('senderCallsign="Eversti"');
  expect(fileShareEvent(share, sender, []).detail).not.toContain("<marti>");
});
