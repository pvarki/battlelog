// @vitest-environment happy-dom
import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import { type TakItem, toChange } from "../cot.ts";
import { importPlan } from "./plans.ts";
import { readShapefile } from "./shapefile.ts";

const sender = { uid: "BattleLog-Eversti", callsign: "Eversti" };

type XY = [number, number];

const TM35FIN_PRJ =
  'PROJCS["ETRS_1989_TM35FIN",GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",27.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';

const bytesOf = (size: number, write: (view: DataView) => void) => {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
};

const pointRecord = ([x, y]: XY) =>
  bytesOf(20, (v) => {
    v.setInt32(0, 1, true);
    v.setFloat64(4, x, true);
    v.setFloat64(12, y, true);
  });

/** PolyLine (3) or Polygon (5); `zBytes` appends a Z variant's range and values. */
const partsRecord = (type: number, parts: XY[][], zBytes = 0) => {
  const points = parts.flat();
  const xyBytes = 44 + parts.length * 4 + points.length * 16;
  return bytesOf(xyBytes + zBytes, (v) => {
    v.setInt32(0, type, true);
    v.setInt32(36, parts.length, true);
    v.setInt32(40, points.length, true);
    let start = 0;
    parts.forEach((part, i) => {
      v.setInt32(44 + i * 4, start, true);
      start += part.length;
    });
    points.forEach(([x, y], i) => {
      v.setFloat64(44 + parts.length * 4 + i * 16, x, true);
      v.setFloat64(52 + parts.length * 4 + i * 16, y, true);
    });
  });
};

const shpOf = (records: Uint8Array[], bbox: number[]) => {
  const size = 100 + records.reduce((sum, r) => sum + 8 + r.length, 0);
  return bytesOf(size, (v) => {
    v.setInt32(0, 9994);
    v.setInt32(24, size / 2);
    v.setInt32(28, 1000, true);
    bbox.forEach((n, i) => {
      v.setFloat64(36 + i * 8, n, true);
    });
    let offset = 100;
    records.forEach((record, i) => {
      v.setInt32(offset, i + 1);
      v.setInt32(offset + 4, record.length / 2);
      new Uint8Array(v.buffer).set(record, offset + 8);
      offset += 8 + record.length;
    });
  });
};

/** A dBASE III table of text fields; `encode` picks the code page. */
const dbfOf = (fields: string[], rows: string[][], encode = strToU8, width = 20) => {
  const headerBytes = 32 + fields.length * 32 + 1;
  const recordBytes = 1 + fields.length * width;
  const bytes = bytesOf(headerBytes + rows.length * recordBytes, (v) => {
    v.setUint8(0, 3);
    v.setUint32(4, rows.length, true);
    v.setUint16(8, headerBytes, true);
    v.setUint16(10, recordBytes, true);
  });
  fields.forEach((name, i) => {
    bytes.set(strToU8(name), 32 + i * 32);
    bytes[32 + i * 32 + 11] = "C".charCodeAt(0);
    bytes[32 + i * 32 + 16] = width;
  });
  bytes[headerBytes - 1] = 0x0d;
  rows.forEach((row, r) => {
    const at = headerBytes + r * recordBytes;
    bytes.fill(0x20, at, at + recordBytes);
    row.forEach((value, i) => {
      bytes.set(encode(value), at + 1 + i * width);
    });
  });
  return bytes;
};

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

const itemsOf = (entries: { event: Parameters<typeof toChange>[0] }[]): TakItem[] =>
  entries.map(({ event }) => {
    const change = toChange(event);
    if (change?.kind !== "upsert") throw new Error("expected a map item");
    return change.item;
  });

const TM35FIN_BBOX = [380000, 6670000, 385000, 6672000];
const outer: XY[] = [
  [380000, 6670000],
  [380000, 6671000],
  [381000, 6671000],
  [381000, 6670000],
  [380000, 6670000],
];
const hole: XY[] = [
  [380200, 6670200],
  [380800, 6670200],
  [380800, 6670800],
  [380200, 6670800],
  [380200, 6670200],
];

test("an ETRS-TM35FIN shapefile reads as WGS84 GeoJSON with its attributes", () => {
  const shp = shpOf(
    [pointRecord([385000, 6672000]), partsRecord(15, [outer, hole], 16 + 10 * 8)],
    TM35FIN_BBOX,
  );
  const dbf = dbfOf(["NAME"], [["Kenttä"], ["Alue"]], latin1);
  const { features } = readShapefile({ shp, dbf, prj: TM35FIN_PRJ });
  const [point, area] = features;
  expect(point?.properties).toEqual({ NAME: "Kenttä" });
  expect(point?.geometry?.type).toBe("Point");
  const [lon, lat] = (point?.geometry?.coordinates ?? []) as XY;
  expect(lon).toBeCloseTo(24.927458, 6);
  expect(lat).toBeCloseTo(60.168666, 6);
  expect(area?.geometry?.type).toBe("MultiPolygon");
  expect(area?.geometry?.coordinates).toHaveLength(1);
});

test("a zipped shapefile imports as a plan of drawings named from the attribute table", async () => {
  const zip = zipSync({
    "kartta/kohteet.shp": shpOf(
      [
        pointRecord([385000, 6672000]),
        partsRecord(5, [outer, hole]),
        partsRecord(3, [outer.slice(0, 3)]),
      ],
      TM35FIN_BBOX,
    ),
    "kartta/kohteet.dbf": dbfOf(["NAME"], [["Kenttä"], ["Alue"], ["Linja"]], latin1),
    "kartta/kohteet.prj": strToU8(TM35FIN_PRJ),
    "__MACOSX/kartta/._kohteet.shp": strToU8("AppleDouble"),
  });
  const plan = await importPlan([new File([zip.slice()], "Harjoitus.zip")], sender);
  const [marker, area, line] = itemsOf(plan.entries);
  expect(plan.name).toBe("Harjoitus");
  expect(marker).toMatchObject({ type: "b-m-p-s-m", callsign: "Kenttä" });
  expect(area).toMatchObject({ type: "u-d-f", callsign: "Alue", geometry: { type: "Polygon" } });
  expect(area?.geometry.coordinates[0]).toHaveLength(5);
  expect(line).toMatchObject({ callsign: "Linja", geometry: { type: "LineString" } });
});

test("a .shp picked with its .dbf and .cpg imports with the named code page", async () => {
  const files = [
    new File([shpOf([pointRecord([24.9, 60.1])], [24.9, 60.1, 24.9, 60.1]).slice()], "op.shp"),
    new File([dbfOf(["name"], [["Tähystys"]]).slice()], "op.dbf"),
    new File(["UTF-8"], "op.cpg"),
    new File([""], "op.shx"),
  ];
  const [marker] = itemsOf((await importPlan(files, sender)).entries);
  expect(marker).toMatchObject({
    callsign: "Tähystys",
    geometry: { type: "Point", coordinates: [24.9, 60.1] },
  });
});

test("a projected shapefile without a .prj, or a damaged one, is refused", () => {
  const projected = shpOf([pointRecord([385000, 6672000])], TM35FIN_BBOX);
  expect(() => readShapefile({ shp: projected })).toThrow(/no \.prj/);
  expect(() => readShapefile({ shp: projected.slice(0, 110), prj: TM35FIN_PRJ })).toThrow(
    /damaged/,
  );
  expect(() => readShapefile({ shp: strToU8("not a shapefile") })).toThrow(/Not a shapefile/);
});

test("an attribute table whose records are shorter than their fields is refused", () => {
  const shp = shpOf([pointRecord([385000, 6672000])], TM35FIN_BBOX);
  const dbf = dbfOf(["NAME", "KIND"], [["a", "b"]]);
  new DataView(dbf.buffer).setUint16(10, 2, true);
  expect(() => readShapefile({ shp, dbf, prj: TM35FIN_PRJ })).toThrow(/damaged/);
});

test("an attribute table of over a million cells is refused before it is read", () => {
  const shp = shpOf([pointRecord([385000, 6672000])], TM35FIN_BBOX);
  const dbf = dbfOf(
    ["A", "B"],
    Array.from({ length: 500_001 }, () => ["", ""]),
    strToU8,
    1,
  );
  expect(() => readShapefile({ shp, dbf, prj: TM35FIN_PRJ })).toThrow(/too large/);
});

test("part indexes that overlap are refused instead of copying points over and over", () => {
  const line = partsRecord(3, [outer, outer, outer]);
  new DataView(line.buffer, line.byteOffset).setInt32(52, 0, true);
  const shp = shpOf([line], TM35FIN_BBOX);
  expect(() => readShapefile({ shp, prj: TM35FIN_PRJ })).toThrow(/damaged/);
});
