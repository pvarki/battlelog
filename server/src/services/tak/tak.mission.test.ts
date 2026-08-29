import { describe, expect, it } from "vitest";
import type { IngestSourceRow } from "../../db/schema.ts";
import { rememberCallsign } from "./tak.callsigns.ts";
import { missionChangeToCreateInput, missionsToPoll } from "./tak.mission.ts";

/**
 * Shapes taken from TAK 5.8's MissionChange model — note `details`, which is the
 * JSON name of the uidDetails field and the one easy thing to get wrong here.
 */
const markerAdded = {
  type: "ADD_CONTENT",
  missionName: "RECON 29.08",
  timestamp: "2026-08-29T09:15:00.000Z",
  creatorUid: "ANDROID-9f3c1a",
  contentUid: "6a1f-marker",
  details: {
    type: "a-h-G-U-C-I",
    callsign: "VIHOLLINEN-1",
    color: "-65536",
    location: { lat: 60.17, lon: 24.94 },
  },
};

describe("missionChangeToCreateInput", () => {
  it("names the operator by callsign once the stream has seen their uid", () => {
    rememberCallsign("ANDROID-9f3c1a", "PARTIO-3");
    const event = missionChangeToCreateInput(markerAdded, "RECON 29.08", "src-1");
    expect(event.createdBy).toBe("tak:PARTIO-3");
    expect(event.header).toBe(
      "RECON 29.08: PARTIO-3 added VIHOLLINEN-1 (Hostile, Ground, Infantry)",
    );
    expect(event.locationPoint).toEqual([24.94, 60.17]);
    expect(event.type).toBe("tak-mission");
    expect(event.tags).toEqual(["tak", "mission", "RECON 29.08", "a-h-G-U-C-I"]);
    expect(event.eventTime?.toISOString()).toBe("2026-08-29T09:15:00.000Z");
    expect(event.sourceUri).toBe(
      "tak://mission/RECON%2029.08/2026-08-29T09:15:00.000Z/ADD_CONTENT/6a1f-marker",
    );
  });

  it("falls back to the raw uid rather than inventing a callsign", () => {
    const event = missionChangeToCreateInput(
      { ...markerAdded, creatorUid: "ANDROID-never-seen" },
      "RECON",
    );
    expect(event.createdBy).toBe("tak:ANDROID-never-seen");
  });

  it("gives a file change a header and no position", () => {
    const event = missionChangeToCreateInput(
      {
        type: "ADD_CONTENT",
        timestamp: "2026-08-29T09:20:00.000Z",
        creatorUid: "ANDROID-9f3c1a",
        contentHash: "abc123",
        contentResource: { filename: "kohde.jpg", name: "kohde.jpg", size: 4096 },
      },
      "RECON",
    );
    expect(event.header).toContain("kohde.jpg");
    expect(event.locationPoint).toBeNull();
    expect(event.data).toMatchObject({ filename: "kohde.jpg", fileSize: 4096 });
  });

  it("never produces an empty header, whatever TAK sends", () => {
    expect(missionChangeToCreateInput({}, "RECON").header.length).toBeGreaterThan(0);
  });

  it("drops 0,0, which is TAK's way of saying there is no position", () => {
    const event = missionChangeToCreateInput(
      { ...markerAdded, details: { ...markerAdded.details, location: { lat: 0, lon: 0 } } },
      "RECON",
    );
    expect(event.locationPoint).toBeNull();
  });
});

const source = (id: string, missions: string[]): IngestSourceRow =>
  ({ id, kind: "tak", config: { missions } }) as unknown as IngestSourceRow;

describe("missionsToPoll", () => {
  it("polls each feed once, attributing a shared one to the first setup", () => {
    const wanted = missionsToPoll([source("a", ["RECON", "HAVAINNOT"]), source("b", ["RECON"])]);
    expect([...wanted.keys()]).toEqual(["RECON", "HAVAINNOT"]);
    expect(wanted.get("RECON")?.id).toBe("a");
  });

  it("ignores stream-filter setups, which name no feed", () => {
    expect(missionsToPoll([{ id: "c", kind: "tak", config: {} } as never]).size).toBe(0);
  });
});
