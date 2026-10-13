// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, type TakItem, toChange } from "../cot.ts";
import { gpxToEvents, itemsToKml, kmlToEvents } from "./overlay-files.ts";

const sender = { uid: "BattleLog-Eversti", callsign: "Eversti" };

const itemOf = (event: CotEvent): TakItem => {
  const change = toChange(event);
  if (change?.kind !== "upsert") throw new Error("expected a map item");
  return change.item;
};

const KML = `<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Style id="red"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle><PolyStyle><color>800000ff</color></PolyStyle></Style>
  <StyleMap id="redMap"><Pair><key>normal</key><styleUrl>#red</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#x</styleUrl></Pair></StyleMap>
  <Folder>
    <Placemark><name>OP Kallio</name><description>&lt;b&gt;Tähystys&lt;/b&gt; &amp;amp; valvonta</description>
      <Style><IconStyle><color>ff00ff00</color></IconStyle></Style>
      <Point><coordinates>22.25,60.45,12</coordinates></Point></Placemark>
    <Placemark><name>Etulinja</name><styleUrl>#redMap</styleUrl>
      <LineString><coordinates>22.1,60.4 22.2,60.5
        22.3,60.4</coordinates></LineString></Placemark>
    <Placemark><name>Alue</name><styleUrl>#red</styleUrl>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>22,60 22.1,60 22.1,60.1 22,60</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    <Placemark><name>Broken</name><Point><coordinates>999,60</coordinates></Point></Placemark>
  </Folder>
</Document></kml>`;

test("KML placemarks become ATAK markers, lines and closed shapes with their names, remarks and colours", () => {
  const [marker, line, area, ...rest] = kmlToEvents(KML, sender).map(itemOf);
  expect(rest).toEqual([]);
  expect(marker).toMatchObject({
    type: "b-m-p-s-m",
    callsign: "OP Kallio",
    remarks: "Tähystys & valvonta",
    geometry: { type: "Point", coordinates: [22.25, 60.45] },
    stroke: { color: "#00ff00" },
  });
  expect(line).toMatchObject({
    type: "u-d-f",
    callsign: "Etulinja",
    geometry: {
      type: "LineString",
      coordinates: [
        [22.1, 60.4],
        [22.2, 60.5],
        [22.3, 60.4],
      ],
    },
    stroke: { color: "#ff0000", opacity: 1 },
    strokeWidth: 4,
  });
  expect(area).toMatchObject({
    type: "u-d-f",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [22, 60],
          [22.1, 60],
          [22.1, 60.1],
          [22, 60],
        ],
      ],
    },
    fill: { color: "#ff0000", opacity: 0.5 },
  });
});

test("GPX waypoints, tracks and routes become markers, lines and an ATAK route", () => {
  const gpx = `<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
    <wpt lat="60.1" lon="24.9"><name>Kokoontuminen</name><desc>Klo 06</desc></wpt>
    <trk><name>Partio</name><trkseg><trkpt lat="60.1" lon="24.9"/><trkpt lat="60.2" lon="25.0"/></trkseg></trk>
    <rte><name>Reitti</name><rtept lat="60.1" lon="24.9"><name>Lähtö</name></rtept><rtept lat="60.3" lon="25.1"/></rte>
  </gpx>`;
  const [wpt, trk, rte] = gpxToEvents(gpx, sender).map(itemOf);
  expect(wpt).toMatchObject({ type: "b-m-p-s-m", callsign: "Kokoontuminen", remarks: "Klo 06" });
  expect(trk).toMatchObject({
    type: "u-d-f",
    callsign: "Partio",
    geometry: { type: "LineString" },
  });
  expect(rte).toMatchObject({
    type: "b-m-r",
    callsign: "Reitti",
    geometry: {
      type: "LineString",
      coordinates: [
        [24.9, 60.1],
        [25.1, 60.3],
      ],
    },
    waypoints: [
      { name: "Lähtö", position: [24.9, 60.1] },
      { name: "VDO", position: [25.1, 60.3] },
    ],
  });
});

test("exported KML imports back as the same drawings", () => {
  const items = kmlToEvents(KML, sender).map(itemOf);
  const back = kmlToEvents(itemsToKml("Export", items), sender).map(itemOf);
  const essentials = ({ type, callsign, remarks, geometry, stroke, fill }: TakItem) => ({
    type,
    callsign,
    remarks,
    geometry,
    stroke,
    fill,
  });
  expect(back.map(essentials)).toEqual(items.map(essentials));
});

test("a circle exports as a closed ring around its centre", () => {
  const circle = itemOf({
    ...kmlToEvents(KML, sender)[0],
    type: "u-d-c-c",
    detail:
      '<contact callsign="Ympyrä"/><shape><ellipse major="1000" minor="1000" angle="360"/></shape>',
  } as CotEvent);
  const [area] = kmlToEvents(itemsToKml("c", [circle]), sender).map(itemOf);
  const ring = area?.geometry.coordinates[0] as [number, number][];
  expect(ring.length).toBeGreaterThan(32);
  expect(Math.max(...ring.map(([, lat]) => lat))).toBeCloseTo(60.45 + 1000 / 111_195, 4);
});

test("a file that isn't XML is refused", () => {
  expect(() => kmlToEvents("<kml", sender)).toThrow();
});
