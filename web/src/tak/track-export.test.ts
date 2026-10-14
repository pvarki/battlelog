// @vitest-environment happy-dom
import { expect, test } from "vitest";
import type { TakItem } from "./cot.ts";
import type { CotEvent } from "./protocol/cot-event.ts";
import { historyTrack, trackToGpx, trackToKml } from "./track-export.ts";

const report = (time: number, lon: number, lat = 60) => ({ time, lon, lat }) as CotEvent;

test("history becomes one time-ordered track without no-fix reports or repeats", () => {
  const track = historyTrack([report(3, 25.2), report(1, 25), report(2, 0, 0), report(3, 25.2)]);
  expect(track).toEqual([
    { position: [25, 60], time: 1 },
    { position: [25.2, 60], time: 3 },
  ]);
});

test("GPX carries every point with its time", () => {
  const gpx = trackToGpx("Alpha <1>", [{ position: [25.5, 60.25], time: Date.UTC(2026, 0, 2) }]);
  const doc = new DOMParser().parseFromString(gpx, "application/xml");
  expect(doc.querySelector("trk > name")?.textContent).toBe("Alpha <1>");
  const point = doc.querySelector("trkpt");
  expect([point?.getAttribute("lat"), point?.getAttribute("lon")]).toEqual(["60.25", "25.5"]);
  expect(point?.querySelector("time")?.textContent).toBe("2026-01-02T00:00:00.000Z");
});

test("KML draws the track as a line", () => {
  const unit = {
    uid: "u1",
    type: "a-f-G",
    callsign: "Alpha",
    geometry: { type: "Point", coordinates: [25, 60] },
  } as TakItem;
  const kml = trackToKml(unit, [
    { position: [25, 60], time: 1 },
    { position: [25.1, 60], time: 2 },
  ]);
  expect(kml).toContain("<LineString><coordinates>25,60 25.1,60</coordinates></LineString>");
});
