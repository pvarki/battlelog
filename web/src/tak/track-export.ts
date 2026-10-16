import type { TakItem } from "./cot.ts";
import { itemsToKml } from "./plans/overlay-files.ts";
import type { CotEvent } from "./protocol/cot-event.ts";
import { escapeXml } from "./protocol/cot-xml.ts";
import { type TrackPoint, trackColor, trackPointOf } from "./tracks.ts";

/** Where an item has been as GPX (with times) or KML (the line only), from TAK's stored copies of it. */

/** Stored copies as one track in time order: no-fix reports and repeated times dropped. */
export const historyTrack = (events: CotEvent[]): TrackPoint[] => {
  const points = events
    .map(trackPointOf)
    .filter(({ position: [lon, lat] }) => lon !== 0 || lat !== 0)
    .sort((a, b) => a.time - b.time);
  return points.filter((point, i) => point.time !== points[i - 1]?.time);
};

export const trackToGpx = (name: string, points: TrackPoint[]): string => {
  const trkpts = points
    .map(
      ({ position: [lon, lat], time }) =>
        `<trkpt lat="${lat}" lon="${lon}"><time>${new Date(time).toISOString()}</time></trkpt>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="BattleLog" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${escapeXml(name)}</name><trkseg>${trkpts}</trkseg></trk></gpx>`;
};

/** The track as a line drawn in the item's track colour. */
export const trackToKml = (item: TakItem, points: TrackPoint[]): string =>
  itemsToKml(item.callsign ?? item.uid, [
    {
      ...item,
      geometry: { type: "LineString", coordinates: points.map((p) => p.position) },
      ellipse: undefined,
      stroke: { color: trackColor(item), opacity: 1 },
      fill: undefined,
    },
  ]);
