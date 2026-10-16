// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { fileShareEvent } from "../datapackage.ts";
import { isOnTak, parseFileShare, readPackage } from "./fileshare.ts";

const hash = "a".repeat(64);
const takUrl = "https://tak.example.fi:8443";

test("a file-share announcement as ATAK writes it reads back as the package it offers", () => {
  const event = fileShareEvent(
    { fileName: "Kaikki.zip", hash, size: 1013, name: "Kaikki" },
    { uid: "ANDROID-1", callsign: "Eetu" },
    [],
  );
  expect(parseFileShare(event)).toMatchObject({
    id: event.uid,
    hash,
    name: "Kaikki",
    size: 1013,
    senderCallsign: "Eetu",
  });
  expect(parseFileShare({ ...event, type: "b-t-f" })).toBeUndefined();
  expect(parseFileShare({ ...event, detail: '<fileshare sha256="../x"/>' })).toBeUndefined();
});

test("only downloads on our TAK Server count as available", () => {
  expect(isOnTak(`${takUrl}/Marti/sync/content?hash=${hash}`, [takUrl])).toBe(true);
  expect(isOnTak(`http://10.0.0.5:8080/getfile?file=x`, [takUrl])).toBe(false);
  expect(isOnTak(`https://evil.example/Marti/sync/content?hash=${hash}`, [takUrl])).toBe(false);
  expect(isOnTak("not a url", [takUrl])).toBe(false);
});

const encode = (s: string) => new TextEncoder().encode(s);

test("a package's files sort into map items, attachments of an item and loose files", () => {
  const manifest = `<MissionPackageManifest version="2"><Configuration><Parameter name="name" value="Kuva"/></Configuration><Contents>
    <Content ignore="false" zipEntry="m/m.cot"><Parameter name="uid" value="marker-1"/></Content>
    <Content ignore="false" zipEntry="p/photo.jpg"><Parameter name="uid" value="marker-1"/></Content>
    <Content ignore="false" zipEntry="orders.pdf"/>
    <Content ignore="true" zipEntry="skip.txt"/>
  </Contents></MissionPackageManifest>`;
  const contents = readPackage({
    "MANIFEST/manifest.xml": encode(manifest),
    "m/m.cot": encode("<event/>"),
    "p/photo.jpg": new Uint8Array([1]),
    "orders.pdf": new Uint8Array([2]),
    "skip.txt": new Uint8Array([3]),
  });
  expect(contents.name).toBe("Kuva");
  expect(contents.cot.map((f) => f.path)).toEqual(["m/m.cot"]);
  expect(contents.attachments.map((f) => [f.name, f.uid])).toEqual([["photo.jpg", "marker-1"]]);
  expect(contents.other.map((f) => f.name)).toEqual(["orders.pdf"]);
});
