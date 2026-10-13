// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, type TakItem, toChange } from "../cot.ts";
import { renderGraphic, symbolFor, toFeatures, upright } from "./tactical.ts";

const R = await import("@armyc2.c5isr.renderer/mil-sym-ts-web");

const drawing = (type: string, detail: string): TakItem => {
  const event: CotEvent = {
    uid: "d1",
    type,
    how: "h-e",
    time: 1000,
    start: 1000,
    stale: 2000,
    lat: 60.17,
    lon: 21.95,
    hae: 0,
    ce: 0,
    le: 0,
    detail,
  };
  const change = toChange(event);
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  return change.item;
};

// As ATAK and CloudTAK sent them to the dev TAK server.
const MSR = drawing(
  "u-d-f",
  '<contact callsign="Claude test line"/><__milsym id="G*S*LRM---****X"/><strokeColor value="-32768"/><strokeWeight value="3"/><link point="60.165,21.93"/><link point="60.17,21.95"/><link point="60.166,21.97"/><link point="60.172,21.99"/>',
);
const HAZARD_ON_RECTANGLE = drawing(
  "u-d-r",
  '<contact callsign="Navigational Hazard 1"/><link point="60.19668,21.92923"/><link point="60.18184,21.91124"/><link point="60.17948,21.91908"/><link point="60.19431,21.93708"/><__milsym id="G*O*HN----****X"/><strokeColor value="-256"/>',
);
const area = (sidc: string): TakItem => ({
  ...MSR,
  sidc,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [21.907, 60.2],
        [21.892, 60.183],
        [21.902, 60.181],
        [21.918, 60.198],
        [21.907, 60.2],
      ],
    ],
  },
});

test("labels never read upside down", () => {
  expect(upright(30, "center")).toEqual({ angle: 30, anchor: "center" });
  expect(upright(-90, "left")).toEqual({ angle: -90, anchor: "left" });
  expect(upright(135, "left")).toEqual({ angle: -45, anchor: "right" });
  expect(upright(-150, "right")).toEqual({ angle: 30, anchor: "left" });
  expect(upright(400, "center")).toEqual({ angle: 40, anchor: "center" });
});

test("renderer output keeps its styling and drops what isn't drawn", () => {
  const features = toFeatures([
    {
      geometry: { type: "MultiLineString", coordinates: [] },
      properties: {
        strokeColor: "#FFFF00",
        lineOpacity: 1,
        strokeWidth: 4,
        strokeDasharray: [8, 4],
      },
    },
    {
      geometry: { type: "Polygon", coordinates: [] },
      properties: { strokeColor: "#FF0000", fillPattern: "data:image/svg+xml;base64,AA" },
    },
    { geometry: { type: "Point", coordinates: [0, 0] }, properties: { label: "WFZ", angle: 190 } },
    { geometry: { type: "Point", coordinates: [0, 0] }, properties: { label: "TIME FROM: " } },
    {
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { image: "data:x", angle: 10 },
    },
    { geometry: { type: "Polygon", coordinates: [] }, properties: { symbolID: "1100" } },
  ]);
  expect(features.map((f) => f.properties)).toEqual([
    { stroke: "#FFFF00", strokeOpacity: 1, strokeWidth: 4, dash: [2, 1] },
    {
      stroke: "#FF0000",
      strokeOpacity: 1,
      strokeWidth: 3,
      dash: [1, 0],
      pattern: "data:image/svg+xml;base64,AA",
    },
    { label: "WFZ", angle: 10, anchor: "center" },
    { image: "data:x", angle: 10 },
  ]);
});

test("ATAK's wildcard SIDCs map to the graphic that fits the drawing", () => {
  const line = MSR.geometry as Extract<TakItem["geometry"], { type: "LineString" }>;
  expect(symbolFor(R, "G*S*LRM---****X", line)).toBe(symbolFor(R, "G-S-LRM-------X", line));
  expect(symbolFor(R, "G*S*LRM---****X", line)).toBeDefined();
  // An area graphic on a line, and a two-point graphic on four points, stay plain.
  expect(symbolFor(R, "G*G*AAW---****X", line)).toBeUndefined();
  expect(symbolFor(R, "G*F*LT----****X", line)).toBeUndefined();
  expect(renderGraphic(R, HAZARD_ON_RECTANGLE)).toBeUndefined();
  expect(renderGraphic(R, { ...MSR, sidc: "G*Z*ZZZZ--****X" })).toBeUndefined();
});

test("a main supply route renders in the drawing's colour with its name", () => {
  const features = renderGraphic(R, MSR) ?? [];
  const lines = features.filter((f) => f.geometry.type === "MultiLineString");
  expect(lines.length).toBeGreaterThan(0);
  expect(lines[0]?.properties).toMatchObject({ stroke: "#FF8000", strokeWidth: 3 });
  expect(features.map((f) => f.properties?.label)).toContain("MSR Claude test line");
});

test("an area graphic keeps the drawn area and its fill pattern", () => {
  const features = renderGraphic(R, area("G*G*AAW---****X")) ?? [];
  expect(features[0]?.properties).toEqual({ fill: "#ffffff", fillOpacity: 0 });
  expect(features.some((f) => String(f.properties?.pattern).startsWith("data:image/svg"))).toBe(
    true,
  );
  expect(features.map((f) => f.properties?.label)).toContain("WFZ");
});
