import type { CotEvent, Position } from "../cot.ts";
import { escapeXml, type Sender } from "../drawing/new-items.ts";
import { distance } from "../geo.ts";

/**
 * This browser's own position report (PLI), written the way ATAK writes its
 * self SA (`CotMapComponent.getSelfEvent`): a friendly ground unit with the
 * user's contact, team and role, so TAK users see it as one of their own.
 */

export type Fix = {
  position: Position;
  /** Metres above the WGS84 ellipsoid, when the device knows it. */
  hae?: number;
  /** Horizontal and vertical accuracy in metres. */
  accuracy: number;
  altitudeAccuracy?: number;
  /** Metres per second and degrees true. */
  speed?: number;
  course?: number;
};

export type SelfIdentity = Sender & { team: string; role: string };

export const SELF_TYPE = "a-f-G-U-C";
/** ATAK's roles, as its preferences offer them. */
export const ROLES = [
  "Team Member",
  "Team Lead",
  "HQ",
  "Sniper",
  "Medic",
  "Forward Observer",
  "RTO",
  "K9",
];
export const DEFAULT_TEAM = "Cyan";
export const DEFAULT_ROLE = "Team Member";

const STALE_MS = 120_000;
export const MOVING_INTERVAL_MS = 5_000;
export const IDLE_INTERVAL_MS = 30_000;
const MOVED_M = 10;
const UNKNOWN = 9_999_999;

export const newSelfSaEvent = (
  fix: Fix,
  self: SelfIdentity,
  device: { os: string; battery?: number },
  now = Date.now(),
): CotEvent => {
  const [lon, lat] = fix.position;
  const callsign = escapeXml(self.callsign);
  const detail = [
    `<takv device="browser" platform="BattleLog" os="${escapeXml(device.os)}"/>`,
    `<contact endpoint="*:-1:stcp" callsign="${callsign}"/>`,
    `<uid Droid="${callsign}"/>`,
    `<precisionlocation geopointsrc="GPS" altsrc="${fix.hae === undefined ? "???" : "GPS"}"/>`,
    `<__group name="${escapeXml(self.team)}" role="${escapeXml(self.role)}"/>`,
    device.battery === undefined ? "" : `<status battery="${device.battery}"/>`,
    `<track course="${fix.course ?? 0}" speed="${fix.speed ?? 0}"/>`,
  ].join("");
  return {
    uid: self.uid,
    type: SELF_TYPE,
    how: "m-g",
    time: now,
    start: now,
    stale: now + STALE_MS,
    lat,
    lon,
    hae: fix.hae ?? UNKNOWN,
    ce: fix.accuracy,
    le: fix.altitudeAccuracy ?? UNKNOWN,
    detail,
  };
};

/** ATAK's pacing: often while moving, a heartbeat while still. */
export const isSendDue = (
  last: { position: Position; time: number } | undefined,
  position: Position,
  now: number,
): boolean => {
  if (!last) return true;
  const elapsed = now - last.time;
  if (elapsed >= IDLE_INTERVAL_MS) return true;
  return elapsed >= MOVING_INTERVAL_MS && distance(last.position, position) >= MOVED_M;
};
