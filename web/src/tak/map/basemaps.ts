/**
 * Background maps. Each is a raster tile source, so offline use later means
 * adding a source that reads cached or downloaded tiles; the map code stays.
 *
 * MML maps come from MML's open WMTS when a (free) API key is configured.
 * Without one they fall back to Kapsi's WMS of the same maps, which still
 * works but runs on a backend Kapsi has started retiring.
 */

const MML_KEY: string | undefined = import.meta.env.VITE_MML_API_KEY;
const MML_ATTRIBUTION = "© Maanmittauslaitos (CC BY 4.0)";

// MML's WMTS template has the row before the column: {z}/{y}/{x}.
const mmlWmts = (layer: string, format: "png" | "jpg") =>
  `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/${layer}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.${format}?api-key=${MML_KEY}`;

const kapsiWms = (layer: string) =>
  `https://tiles.kartat.kapsi.fi/${layer}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${layer}&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg`;

const mml = (label: string, wmtsLayer: string, format: "png" | "jpg", kapsiLayer: string) => ({
  label,
  tiles: MML_KEY ? mmlWmts(wmtsLayer, format) : kapsiWms(kapsiLayer),
  attribution: MML_ATTRIBUTION,
  maxzoom: 19,
});

export const BASEMAPS = {
  topographic: mml("MML topographic", "maastokartta", "png", "peruskartta"),
  background: mml("MML background", "taustakartta", "png", "taustakartta"),
  // ponytail: ortokuva's WMTS format (jpg) is unverified without a key; check on first keyed run.
  orthophoto: mml("MML orthophoto", "ortokuva", "jpg", "ortokuva"),
  osm: {
    label: "OpenStreetMap",
    tiles: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxzoom: 19,
  },
};

export type Basemap = keyof typeof BASEMAPS;
