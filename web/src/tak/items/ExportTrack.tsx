import type { TakItem } from "../cot.ts";
import { download } from "../download.ts";
import { labelOf } from "../items.ts";
import { fetchHistory } from "../rest.ts";
import { DAY_MS } from "../store.ts";
import { historyTrack, trackToGpx, trackToKml } from "../track-export.ts";
import type { TrackPoint } from "../tracks.ts";

// ponytail: one request for the whole span; a fast reporter over a week is a large download.
const HISTORY_MS = 7 * DAY_MS;

const FORMATS = {
  gpx: {
    type: "application/gpx+xml",
    build: (item: TakItem, points: TrackPoint[]) => trackToGpx(labelOf(item), points),
  },
  kml: { type: "application/vnd.google-earth.kml+xml", build: trackToKml },
};

/** Downloads where the item has been over TAK's stored history of it; throws with a reason to show. */
export const exportTrack = async (item: TakItem, format: keyof typeof FORMATS) => {
  let points: TrackPoint[];
  try {
    points = historyTrack(await fetchHistory(item.uid, HISTORY_MS / 1000));
  } catch (err) {
    console.warn("TAK track export failed", err);
    throw new Error("TAK's history couldn't be loaded");
  }
  if (points.length < 2) throw new Error("TAK has no movement stored for this item");
  const { type, build } = FORMATS[format];
  download(new Blob([build(item, points)], { type }), `${labelOf(item)} track.${format}`);
};

export const TRACK_FORMATS = Object.keys(FORMATS) as (keyof typeof FORMATS)[];
