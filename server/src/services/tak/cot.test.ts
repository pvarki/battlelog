import { describe, expect, test } from "vitest";
import { argbToColor, parseCot, splitEvents } from "./cot.ts";

const T =
  "time='2026-10-09T21:27:17.090Z' start='2026-10-09T21:27:17.090Z' stale='2026-10-09T21:31:31.964Z'";

const pli = `<event version='2.0' uid='ANDROID-test1' type='a-f-G-U-C' ${T} how='h-e'><point lat='60.158325' lon='24.933839' hae='31' ce='9' le='9999999.0' /><detail><contact callsign="Alpha1" endpoint="*:-1:stcp"/><__group name="Cyan" role="Team Member"/><status battery="88"/><takv platform="ATAK-CIV" version="5.8.0.4" device="Pixel"/><track speed="0.0" course="0.0"/></detail></event>`;

const circle = `<event version="2.0" uid="c1" type="u-d-c-c" how="h-e" ${T}><point lat="61.4978" lon="23.761" hae="9999999.0" ce="9999999.0" le="9999999.0"/><detail><shape><ellipse major="10000" minor="10000" angle="360"/></shape><contact callsign="Ring"/><remarks>10 km</remarks><strokeColor value="-65536"/><strokeWeight value="3.0"/><fillColor value="1090453504"/></detail></event>`;

const polygon = `<event version="2.0" uid="p1" type="u-d-f" how="h-e" ${T}><point lat="60.2" lon="24.93"/><detail><link point="60.208,24.918"/><link point="60.208,24.948"/><link point="60.192,24.948"/><link point="60.208,24.918"/><strokeColor value="-65536"/><contact callsign="OBJ"/></detail></event>`;

const line = `<event version="2.0" uid="l1" type="u-d-f" how="h-e" ${T}><point lat="60.3" lon="24.9"/><detail><link point="60.345,24.88"/><link point="60.345,25.14"/><contact callsign="LD"/></detail></event>`;

const rectangle = `<event version="2.0" uid="r1" type="u-d-r" how="h-e" ${T}><point lat="60.3" lon="24.9"/><detail><link point="60.4,24.9"/><link point="60.4,25.0"/><link point="60.3,25.0"/><link point="60.3,24.9"/></detail></event>`;

const route = `<event version='2.0' uid='rt1' type='b-m-r' ${T} how='h-e'><point lat='0.0' lon='0.0' hae='9999999' ce='9999999.0' le='9999999.0' /><detail><contact callsign="Loop"/><link uid="w0" callsign="Loop SP" type="b-m-p-w" point="63.3459819,30.4747019,131.776" relation="c"/><link uid="w1" callsign="" type="b-m-p-c" point="63.3449828,30.4761362,130.693" relation="c"/><link uid="w2" callsign="END" type="b-m-p-w" point="63.3453229,30.4768003" relation="c"/></detail></event>`;

const remove = `<event version="2.0" uid="d1" type="t-x-d-d" how="h-g-i-g-o" ${T}><point lat="0" lon="0"/><detail><link uid="c1" relation="none" type="none"/><__forcedelete/></detail></event>`;

const disconnect = `<event version='2.0' uid='x1' type='t-x-d-d' ${T} how='h-g-i-g-o'><point lat='0.0' lon='0.0' hae='0' ce='9999999.0' le='9999999.0' /><detail><link relation="p-p" uid="ANDROID-test1" type="a-f-G-U-C"/></detail></event>`;

const chat = `<event version="2.0" uid="GeoChat.x" type="b-t-f" how="h-g-i-g-o" ${T}><point lat="0" lon="0"/><detail><remarks>hi</remarks></detail></event>`;

const upsert = (xml: string) => {
  const change = parseCot(xml);
  if (change?.kind !== "upsert") throw new Error(`expected upsert, got ${JSON.stringify(change)}`);
  return change.feature;
};

describe("parseCot", () => {
  test("contact position report carries team, battery and device", () => {
    expect(upsert(pli)).toEqual({
      type: "Feature",
      id: "ANDROID-test1",
      geometry: { type: "Point", coordinates: [24.933839, 60.158325] },
      properties: {
        cotType: "a-f-G-U-C",
        callsign: "Alpha1",
        time: "2026-10-09T21:27:17.090Z",
        stale: "2026-10-09T21:31:31.964Z",
        team: "Cyan",
        role: "Team Member",
        battery: 88,
        device: "ATAK-CIV 5.8.0.4",
      },
    });
  });

  test("circle keeps its centre point and radius in metres", () => {
    const f = upsert(circle);
    expect(f.geometry).toEqual({ type: "Point", coordinates: [23.761, 61.4978] });
    expect(f.properties).toMatchObject({
      radius: 10000,
      remarks: "10 km",
      stroke: { color: "#ff0000", opacity: 1 },
      strokeWidth: 3,
      fill: { color: "#ff0000", opacity: 0.25 },
    });
  });

  test("closed freehand shape is a polygon, open one a line", () => {
    expect(upsert(polygon).geometry.type).toBe("Polygon");
    expect(upsert(line).geometry).toEqual({
      type: "LineString",
      coordinates: [
        [24.88, 60.345],
        [25.14, 60.345],
      ],
    });
  });

  test("rectangle is closed into a polygon ring", () => {
    const g = upsert(rectangle).geometry;
    expect(g.type).toBe("Polygon");
    if (g.type === "Polygon") expect(g.coordinates[0]?.at(-1)).toEqual(g.coordinates[0]?.[0]);
  });

  test("route follows its waypoints, ignoring the dummy 0,0 point, and keeps named checkpoints", () => {
    const f = upsert(route);
    expect(f.geometry.type).toBe("LineString");
    if (f.geometry.type === "LineString") expect(f.geometry.coordinates).toHaveLength(3);
    expect(f.properties.checkpoints?.map((c) => c.name)).toEqual(["Loop SP", "END"]);
  });

  test("delete targets the linked uid", () => {
    expect(parseCot(remove)).toEqual({
      kind: "delete",
      uid: "c1",
      time: "2026-10-09T21:27:17.090Z",
    });
  });

  test("TAK's disconnect notice (p-p link, no forcedelete) marks the contact offline", () => {
    expect(parseCot(disconnect)).toEqual({
      kind: "offline",
      uid: "ANDROID-test1",
      time: "2026-10-09T21:27:17.090Z",
    });
  });

  test("non-map traffic (chat, pings, garbage) is ignored", () => {
    expect(parseCot(chat)).toBeNull();
    expect(
      parseCot(`<event uid="p" type="t-x-c-t" ${T}><point lat="0" lon="0"/></event>`),
    ).toBeNull();
    expect(parseCot("<event>")).toBeNull();
  });

  test("malformed XML and invalid timestamps are rejected instead of throwing", () => {
    expect(
      parseCot("<event uid='a' type='a-f-G' time='x'><detail><remarks><![CDATA[cut"),
    ).toBeNull();
    expect(parseCot(pli.replace("2026-10-09T21:27:17.090Z' start", "bogus' start"))).toBeNull();
    expect(
      upsert(pli.replace("stale='2026-10-09T21:31:31.964Z'", "stale='bogus'")).properties.stale,
    ).toBe("2026-10-09T21:27:17.090Z");
  });

  test("numeric-looking remarks stay strings", () => {
    expect(upsert(circle.replace("10 km", "123")).properties.remarks).toBe("123");
  });
});

describe("argbToColor", () => {
  test("decodes signed ARGB", () => {
    expect(argbToColor("-1")).toEqual({ color: "#ffffff", opacity: 1 });
    expect(argbToColor("16742144")).toEqual({ color: "#ff7700", opacity: 0 });
    expect(argbToColor("nope")).toBeUndefined();
  });
});

describe("splitEvents", () => {
  test("returns complete events and keeps the unfinished tail across chunks", () => {
    const first = splitEvents(`${pli}${circle.slice(0, 40)}`);
    expect(first.events).toEqual([pli]);
    const second = splitEvents(first.rest + circle.slice(40));
    expect(second.events).toEqual([circle]);
    expect(second.rest).toBe("");
  });

  test("keeps a tag split mid-name", () => {
    const { events, rest } = splitEvents(`${pli}<ev`);
    expect(events).toHaveLength(1);
    expect(splitEvents(`${rest}${circle.slice(3)}`).events).toEqual([circle]);
  });
});
