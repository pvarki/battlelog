import proj4 from "proj4";
import { MAX_FEATURES } from "./overlay-files.ts";

/**
 * ESRI shapefiles as GeoJSON in WGS84: geometry from the .shp, attributes from
 * the .dbf (decoded per the .cpg), reprojected from the .prj. Z and M values
 * are dropped; the .shx index is not needed to read the records in order.
 */

export type ShapefileParts = { shp: Uint8Array; dbf?: Uint8Array; prj?: string; cpg?: string };

type XY = [number, number];
type Geometry =
  | { type: "Point"; coordinates: XY }
  | { type: "MultiPoint"; coordinates: XY[] }
  | { type: "MultiLineString"; coordinates: XY[][] }
  | { type: "MultiPolygon"; coordinates: XY[][][] };

const SHP_FILE_CODE = 9994;
const HEADER_BYTES = 100;
const POINT_BYTES = 16;
/** Point, PolyLine, Polygon and MultiPoint; +10 adds Z and +20 M, both after the XY data. */
const SUPPORTED_TYPES = new Set([1, 3, 5, 8, 11, 13, 15, 18, 21, 23, 25, 28]);

const viewOf = (bytes: Uint8Array, offset = 0, length = bytes.byteLength - offset) =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, length);

const projection = (prj: string | undefined, shp: DataView): ((xy: XY) => XY) => {
  if (prj) {
    try {
      const converter = proj4(prj, "WGS84");
      return (xy) => converter.forward(xy);
    } catch {
      throw new Error("Unsupported shapefile projection (.prj)");
    }
  }
  const [xMin, yMin, xMax, yMax] = [36, 44, 52, 60].map((at) => shp.getFloat64(at, true));
  const isLonLat =
    [xMin, xMax].every((x) => Math.abs(x as number) <= 180) &&
    [yMin, yMax].every((y) => Math.abs(y as number) <= 90);
  if (!isLonLat) throw new Error("Shapefile has no .prj and isn't in longitude/latitude");
  return (xy) => xy;
};

/** Outer rings run clockwise; counter-clockwise rings are holes. */
const isClockwise = (ring: XY[]) =>
  ring.reduce((sum, [x1, y1], i) => {
    const [x2, y2] = ring[(i + 1) % ring.length] as XY;
    return sum + (x2 - x1) * (y2 + y1);
  }, 0) > 0;

const readShape = (record: DataView, project: (xy: XY) => XY): Geometry | null => {
  const type = record.getInt32(0, true);
  if (!SUPPORTED_TYPES.has(type)) return null;
  const point = (at: number) =>
    project([record.getFloat64(at, true), record.getFloat64(at + 8, true)]);
  const points = (at: number, count: number) => {
    if (at + count * POINT_BYTES > record.byteLength) throw new RangeError("Truncated record");
    return Array.from({ length: count }, (_, i) => point(at + i * POINT_BYTES));
  };
  const kind = type % 10;
  if (kind === 1) return { type: "Point", coordinates: point(4) };
  if (kind === 8) return { type: "MultiPoint", coordinates: points(40, record.getInt32(36, true)) };
  const [partCount, pointCount] = [record.getInt32(36, true), record.getInt32(40, true)];
  const all = points(44 + partCount * 4, pointCount);
  const partStarts = Array.from({ length: partCount }, (_, i) => record.getInt32(44 + i * 4, true));
  // Parts must tile the points once: overlapping indexes would let a tiny file copy its points endlessly.
  const ascending = partStarts.every((start, i) => start > (partStarts[i - 1] ?? -1));
  if (
    partCount > 0 &&
    (partStarts[0] !== 0 || !ascending || (partStarts.at(-1) ?? 0) >= pointCount)
  )
    throw new RangeError("Bad part indexes");
  const parts = partStarts.map((start, i) => all.slice(start, partStarts[i + 1] ?? pointCount));
  if (kind === 3) return { type: "MultiLineString", coordinates: parts };
  const outers = parts.filter(isClockwise);
  // Holes are dropped (ATAK shapes are single rings); a writer that ignored winding gets every ring.
  return {
    type: "MultiPolygon",
    coordinates: (outers.length > 0 ? outers : parts).map((r) => [r]),
  };
};

const readShp = (bytes: Uint8Array, prj: string | undefined): (Geometry | null)[] => {
  const header = viewOf(bytes, 0, Math.min(bytes.byteLength, HEADER_BYTES));
  if (bytes.byteLength < HEADER_BYTES || header.getInt32(0) !== SHP_FILE_CODE)
    throw new Error("Not a shapefile");
  const project = projection(prj, header);
  const geometries: (Geometry | null)[] = [];
  for (let offset = HEADER_BYTES; offset + 8 <= bytes.byteLength; ) {
    const length = viewOf(bytes, offset, 8).getInt32(4) * 2;
    if (length < 4) throw new RangeError("Bad record length");
    geometries.push(readShape(viewOf(bytes, offset + 8, length), project));
    offset += 8 + length;
  }
  return geometries;
};

/** The .cpg names the .dbf's code page; without one, UTF-8 if it decodes, else Windows-1252. */
const dbfDecoder = (cpg: string | undefined, records: Uint8Array): TextDecoder => {
  const label = cpg?.trim();
  if (label) {
    try {
      return new TextDecoder(/^\d+$/.test(label) && label !== "65001" ? `windows-${label}` : label);
    } catch {
      // An unknown code page reads with the default below.
    }
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(records);
    return new TextDecoder("utf-8");
  } catch {
    return new TextDecoder("windows-1252");
  }
};

const MAX_DBF_CELLS = 1_000_000;

const readDbf = (bytes: Uint8Array, cpg: string | undefined): Record<string, string>[] => {
  const view = viewOf(bytes);
  const headerBytes = view.getUint16(8, true);
  const recordBytes = view.getUint16(10, true);
  const decoder = dbfDecoder(cpg, bytes.subarray(headerBytes));
  const fields: { name: string; length: number }[] = [];
  for (let at = 32; at + 32 <= headerBytes && bytes[at] !== 0x0d; at += 32) {
    const name = decoder.decode(bytes.subarray(at, at + 11)).replace(/\0.*$/s, "");
    fields.push({ name, length: bytes[at + 16] as number });
  }
  const fieldBytes = fields.reduce((sum, { length }) => sum + length, 0);
  if (recordBytes < 1 + fieldBytes) throw new Error("The shapefile is damaged");
  const available = Math.floor((bytes.byteLength - headerBytes) / recordBytes);
  const count = Math.min(view.getUint32(4, true), available);
  if (count > MAX_FEATURES || count * fields.length > MAX_DBF_CELLS)
    throw new Error("The shapefile's attribute table is too large to import");
  return Array.from({ length: count }, (_, i) => {
    let at = headerBytes + i * recordBytes + 1;
    return Object.fromEntries(
      fields.map(({ name, length }) => {
        const value = decoder.decode(bytes.subarray(at, at + length)).trim();
        at += length;
        return [name, value];
      }),
    );
  });
};

export const readShapefile = ({ shp, dbf, prj, cpg }: ShapefileParts) => {
  try {
    const attributes = dbf ? readDbf(dbf, cpg) : [];
    return {
      type: "FeatureCollection" as const,
      features: readShp(shp, prj).map((geometry, i) => ({
        type: "Feature" as const,
        geometry,
        properties: attributes[i] ?? {},
      })),
    };
  } catch (err) {
    // DataView reads past a truncated or lying length field throw RangeError.
    if (err instanceof RangeError) throw new Error("The shapefile is damaged");
    throw err;
  }
};
