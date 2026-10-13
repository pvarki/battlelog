// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, type TakItem, toChange } from "../cot.ts";
import {
  newMarkerEvent,
  newRangeBearingEvent,
  newShapeEvent,
  type ShapeStyle,
  toArgb,
} from "./new-items.ts";

const sender = { uid: "BattleLog-Eversti", callsign: "Eversti" };
const style: ShapeStyle = {
  name: "Etulinja",
  stroke: "#ff0000",
  strokeWeight: 3,
  strokeStyle: "dashed",
  fillOpacity: 0.25,
  labelsOn: true,
  remarks: "Piirretty & lähetetty",
};

const parsed = (event: CotEvent): TakItem => {
  const change = toChange(event);
  if (change?.kind !== "upsert") throw new Error("expected upsert");
  return change.item;
};

test("ATAK's signed ARGB colours", () => {
  expect(toArgb("#ffff00")).toBe(-256);
  expect(toArgb("#ff0000", 0)).toBe(0xff0000);
});

test("a drawn polygon reads back as the closed, styled shape ATAK would send", () => {
  const points: [number, number][] = [
    [22, 60],
    [22.1, 60],
    [22.1, 60.1],
  ];
  const event = newShapeEvent({ kind: "polygon", points }, style, sender, 1_000, "s1");
  expect(event).toMatchObject({
    uid: "s1",
    type: "u-d-f",
    how: "h-e",
    time: 1_000,
    stale: 1_000 + 86_400_000,
  });
  expect(event.detail).toContain('<creator uid="BattleLog-Eversti" callsign="Eversti"');
  const item = parsed(event);
  expect(item.geometry.type).toBe("Polygon");
  expect(item).toMatchObject({
    callsign: "Etulinja",
    strokeStyle: "dashed",
    labelsOn: true,
    remarks: "Piirretty & lähetetty",
    stroke: { color: "#ff0000", opacity: 1 },
    fill: { color: "#ff0000", opacity: 0.25 },
  });
});

test("lines stay open, rectangles and circles keep ATAK's own types", () => {
  const line = parsed(
    newShapeEvent(
      {
        kind: "line",
        points: [
          [22, 60],
          [22.1, 60.1],
        ],
      },
      style,
      sender,
    ),
  );
  expect(line.geometry.type).toBe("LineString");
  expect(line.fill).toBeUndefined();
  const circle = parsed(
    newShapeEvent({ kind: "circle", centre: [22, 60], radius: 250 }, style, sender),
  );
  expect(circle).toMatchObject({ type: "u-d-c-c", ellipse: { major: 250, minor: 250 } });
  const rect = newShapeEvent(
    {
      kind: "rectangle",
      points: [
        [22, 60],
        [22.1, 60],
        [22.1, 60.1],
        [22, 60.1],
      ],
    },
    style,
    sender,
  );
  expect(rect.type).toBe("u-d-r");
});

test("markers: a spot marker in its colour, units by affiliation, with who placed them", () => {
  const marker = {
    position: [22, 60] as [number, number],
    name: "Havainto",
    remarks: "",
    color: "#ffff00",
  };
  const spot = parsed(newMarkerEvent({ ...marker, kind: "spot" }, sender));
  expect(spot).toMatchObject({
    type: "b-m-p-s-m",
    creator: "Eversti",
    stroke: { color: "#ffff00" },
  });
  expect(spot.iconPath).toBe("COT_MAPPING_SPOTMAP/b-m-p-s-m/-256");
  const hostile = parsed(newMarkerEvent({ ...marker, kind: "h" }, sender, 1_000));
  expect(hostile).toMatchObject({ type: "a-h-G", stale: 1_000 + 365 * 86_400_000 });
});

test("a measured leg reads back as the range-and-bearing line ATAK would send", () => {
  const leg: [[number, number], [number, number]] = [
    [25, 60],
    [25.018, 60],
  ];
  const item = parsed(newRangeBearingEvent(leg, "R&B 1", 1_000, "rb"));
  expect(item).toMatchObject({ type: "u-rb-a", callsign: "R&B 1", stroke: { color: "#ff0000" } });
  expect(item.rangeBearing?.northRef).toBe("T");
  expect(item.rangeBearing?.range).toBeCloseTo(1000, -1);
  expect(item.rangeBearing?.bearing).toBeCloseTo(90, 0);
  if (item.geometry.type !== "LineString") throw new Error("expected a line");
  const [, end] = item.geometry.coordinates;
  expect(end?.[0]).toBeCloseTo(25.018, 5);
  expect(end?.[1]).toBeCloseTo(60, 5);
});
