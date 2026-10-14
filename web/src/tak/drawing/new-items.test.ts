// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, type Position, type TakItem, toChange } from "../cot.ts";
import {
  defaultWaypointNames,
  newBullseyeEvent,
  newMarkerEvent,
  newRangeBearingEvent,
  newRangeRingsEvent,
  newRouteEvent,
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

test("icon-set markers: white like ATAK's palette, unknown ground unless the set names a type", () => {
  const marker = {
    position: [22, 60] as [number, number],
    name: "Nuotio",
    remarks: "",
    color: "#ffff00",
    kind: "icon" as const,
  };
  const path = "3c1f9a52-8d0e-4c41-9b0a-1a2d5e7f4b61/Retkeily/nuotiopaikka.png";
  expect(parsed(newMarkerEvent({ ...marker, icon: { path } }, sender))).toMatchObject({
    type: "a-u-G",
    iconPath: path,
    stroke: { color: "#ffffff" },
  });
  const typed = parsed(newMarkerEvent({ ...marker, icon: { path, type: "a-n-G-I" } }, sender));
  expect(typed.type).toBe("a-n-G-I");
});

test("a 2525 symbol marker reads back with its code and ATAK's type", () => {
  const symbol = { sidc: "10061000001211000000", type: "a-h-G-U-C-I" };
  const event = newMarkerEvent(
    {
      position: [22, 60],
      name: "Vihollisryhmä",
      remarks: "",
      color: "#ffffff",
      kind: "symbol",
      symbol,
    },
    sender,
    1_000,
  );
  expect(event.detail).toContain('<__milsym id="10061000001211000000"/>');
  expect(event.detail).toContain('<__milicon id="10061000001211000000"/>');
  expect(parsed(event)).toMatchObject({
    type: "a-h-G-U-C-I",
    sidc: "10061000001211000000",
    callsign: "Vihollisryhmä",
    stale: 1_000 + 365 * 86_400_000,
  });
});

test("a route reads back with its named checkpoints; unnamed points are control points", () => {
  const points: [number, number][] = [
    [22, 60],
    [22.05, 60.02],
    [22.1, 60.1],
  ];
  expect(defaultWaypointNames("Reitti 1", 3)).toEqual(["Reitti 1 SP", "CP1", "VDO"]);
  const event = newRouteEvent(
    {
      points,
      name: "Reitti 1",
      color: "#ffffff",
      remarks: "",
      waypointNames: ["Reitti 1 SP", " ", "VDO"],
    },
    sender,
    1_000,
    "r1",
  );
  expect(event).toMatchObject({ uid: "r1", type: "b-m-r", lat: 0, lon: 0, how: "h-e" });
  expect(event.detail).toContain('callsign="" type="b-m-p-c" point="60.02,22.05"');
  expect(event.detail).toContain('<link_attr planningmethod="Infil" color="-1"');
  expect(event.detail).toContain("<__routeinfo><__navcues/></__routeinfo>");
  const item = parsed(event);
  expect(item.geometry).toEqual({ type: "LineString", coordinates: points });
  expect(item.callsign).toBe("Reitti 1");
  expect(item.waypoints).toEqual([
    { name: "Reitti 1 SP", position: [22, 60] },
    { name: "VDO", position: [22.1, 60.1] },
  ]);
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

test("range rings read back as one ring per spacing, as ATAK's R&B circle", () => {
  const event = newRangeRingsEvent(
    { centre: [25, 60], name: "Renkaat 1", color: "#ff0000", remarks: "", spacing: 500, count: 3 },
    sender,
    1_000,
    "rr",
  );
  expect(event).toMatchObject({ uid: "rr", type: "u-r-b-c-c", lat: 60, lon: 25 });
  expect(event.detail).toContain('<shape><ellipse major="500" minor="500" angle="360"/>');
  const item = parsed(event);
  expect(item).toMatchObject({
    callsign: "Renkaat 1",
    rangeRings: [500, 1000, 1500],
    stroke: { color: "#ff0000", opacity: 1 },
    geometry: { type: "Point", coordinates: [25, 60] },
  });
  expect(item.ellipse).toBeUndefined();
});

test("a bullseye reads back with its radius, bearing style and rings", () => {
  const bullseye = {
    centre: [25, 60] as Position,
    name: "Maali",
    color: "#ffffff",
    remarks: "",
    radius: 2000,
    mils: true,
    edgeToCenter: true,
  };
  const withRings = parsed(
    newBullseyeEvent({ ...bullseye, rings: { spacing: 400, count: 4 } }, sender, 1_000, "be"),
  );
  expect(withRings).toMatchObject({
    type: "u-r-b-bullseye",
    callsign: "Maali",
    bullseye: {
      radius: 2000,
      mils: true,
      northRef: "T",
      edgeToCenter: true,
      rings: { spacing: 400, count: 4 },
    },
  });
  expect(parsed(newBullseyeEvent(bullseye, sender)).bullseye?.rings).toBeUndefined();
});
