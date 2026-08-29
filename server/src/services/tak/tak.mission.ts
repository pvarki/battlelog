import "varlock/auto-load";
import { ENV } from "varlock/env";
import type { IngestSourceRow } from "../../db/schema.ts";
import { logger } from "../../lib/logger.ts";
import { type CreateEventInput, createEventIfNew } from "../events/events.service.ts";
import {
  enabledIngestSources,
  getIngestCursor,
  setIngestCursor,
} from "../ingest/ingest.service.ts";
import { countEvent, setStatus, transportKey } from "../ingest/ingest.state.ts";
import { EVENT_TYPE, INPUT_SOURCE, type TakSourceConfig } from "../ingest/ingest.types.ts";
import { listMissions, missionChanges, type TakMissionChange } from "./tak.api.ts";
import { callsignFor } from "./tak.callsigns.ts";
import { describeCotType } from "./tak.symbol.ts";

/**
 * Data Sync feeds — TAK missions — as feed entries.
 *
 * The CoT stream carries what clients broadcast; a mission is the opposite of
 * that. Its contents are the picture the command has *curated*: a marker only
 * lands in RECON because someone verified it and put it there. That is exactly
 * the traffic a log wants and exactly what the automatic position reports drown
 * out, which is why this is a separate transport rather than another stream
 * filter.
 *
 * Polled rather than pushed. TAK does push mission changes, but only to clients
 * it has a uid for, and it learns a uid from the position reports that client
 * sends. BattleLog sends nothing on purpose — a listener should not appear as a
 * unit on everyone's map — so there is nothing to push to.
 *
 * Mission *chat* is not here: TAK relays it as ordinary GeoChat with the
 * mission's chat room name, so it arrives on the stream and a `chatRooms`
 * filter selects it.
 */

const POLL_INTERVAL_MS = 30_000;

/**
 * Re-read a little further back than the last poll reached.
 *
 * NOT for clock skew: TAK windows /changes on its own `servertime` column, and
 * `secago` is a duration we compute from two of our own timestamps, so the two
 * clocks never meet. What the overlap covers is jitter — a slow poll, a missed
 * tick, a restart between the request and the cursor write. The source_uri
 * unique index makes the resulting repeats free.
 */
const OVERLAP_S = 90;

/**
 * How far back a first poll — or one after a long outage — reaches.
 *
 * A feed that has been running for a week would otherwise arrive all at once,
 * timestamped a week ago, burying whatever is actually happening. A day is
 * enough to survive a restart and short enough not to rewrite history.
 */
const MAX_CATCHUP_S = 24 * 60 * 60;

const MISSIONS = transportKey("tak-missions");

/** Cursor key. Per mission, not per source: two setups naming one feed share the reading. */
const cursorKey = (mission: string): string => `tak-mission:${mission}`;

/**
 * Which feeds to poll, and which setup each entry belongs to.
 *
 * First setup wins a mission it shares with another, the same rule the stream
 * filter uses: one upstream change becomes at most one feed entry, and which
 * setup it is filed under has to be stable rather than a race.
 */
export const missionsToPoll = (sources: IngestSourceRow[]): Map<string, IngestSourceRow> => {
  const wanted = new Map<string, IngestSourceRow>();
  for (const source of sources) {
    for (const mission of (source.config as TakSourceConfig).missions ?? []) {
      const name = mission.trim();
      if (name && !wanted.has(name)) wanted.set(name, source);
    }
  }
  return wanted;
};

const pointOf = (change: TakMissionChange): [number, number] | null => {
  const { lat, lon } = change.details?.location ?? {};
  if (lat === undefined || lon === undefined) return null;
  // 0,0 is TAK's "no position", not the Gulf of Guinea.
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
};

/**
 * What the change is about: a map item's label, or a file's name.
 *
 * All of `details` can be missing. TAK does not store it with the change —
 * findUidDetails looks the marker up in the CoT store when the change is read —
 * so once retention has pruned that marker, the callsign, symbol and position
 * are simply gone. Everything downstream of here treats them as optional for
 * that reason, and the header still names the feed, the author and the verb.
 */
const subjectOf = (change: TakMissionChange): string | undefined =>
  change.details?.callsign ??
  change.details?.title ??
  change.contentResource?.name ??
  change.contentResource?.filename;

/**
 * English, like the decoded CoT symbol it sits next to: a header reading
 * "lisäsi VIHOLLINEN-1 (Hostile, Ground, Infantry)" is worse than either
 * language on its own.
 */
const VERB: Record<string, string> = {
  ADD_CONTENT: "added",
  REMOVE_CONTENT: "removed",
  CREATE_MISSION: "created the feed",
  DELETE_MISSION: "deleted the feed",
  CREATE_DATA_FEED: "attached a data feed",
  DELETE_DATA_FEED: "detached a data feed",
};

const HEADER_MAX_CHARS = 200;

const truncate = (text: string): string =>
  text.length > HEADER_MAX_CHARS ? `${text.slice(0, HEADER_MAX_CHARS - 1)}…` : text;

/**
 * The change's stable identity.
 *
 * Timestamp is part of it: the same marker can be removed from a feed and put
 * back, and both are things that happened. contentUid identifies a map item and
 * contentResource.hash a file — NOT the change's own contentHash, which its
 * getter marks @JsonIgnore and which therefore never arrives. Reading that one
 * left every file change with an empty tail, so two files attached in the same
 * millisecond collided. A mission-level change such as CREATE_MISSION has
 * neither, and its timestamp alone is unique enough.
 */
const sourceUriOf = (change: TakMissionChange, mission: string): string =>
  `tak://mission/${encodeURIComponent(mission)}/${change.timestamp ?? ""}/${change.type ?? "CHANGE"}/${
    change.contentUid ?? change.contentResource?.hash ?? ""
  }`;

/** One mission change as a feed entry. */
export const missionChangeToCreateInput = (
  change: TakMissionChange,
  mission: string,
  ingestSourceId?: string,
): CreateEventInput => {
  // The change log names its author by device uid. Trade it for the callsign
  // the stream has seen that uid use; a uid nobody has reported under stays a
  // uid rather than becoming a lie.
  const uid = change.creatorUid;
  const author = callsignFor(uid) ?? uid ?? "tuntematon";
  const verb = VERB[change.type ?? ""] ?? (change.type ?? "muutti").toLowerCase();
  const subject = subjectOf(change);
  const symbol = change.details?.type ? describeCotType(change.details.type) : undefined;
  // "RECON: KOMPPANIA-1 lisäsi Vihollinen 1 (Vihollinen, Maa, Jalkaväki)"
  const what = [subject, symbol && subject !== symbol ? `(${symbol})` : undefined]
    .filter(Boolean)
    .join(" ");
  const eventTime = change.timestamp ? new Date(change.timestamp) : null;
  return {
    createdBy: `tak:${author}`,
    updatedBy: null,
    header: truncate(`${mission}: ${author} ${verb}${what ? ` ${what}` : ""}`),
    eventTime: eventTime && !Number.isNaN(eventTime.getTime()) ? eventTime : null,
    tags: ["tak", "mission", mission, ...(change.details?.type ? [change.details.type] : [])],
    hcoeDomains: null,
    // Nothing in a mission change rates its source, and inventing a rating
    // would be a claim TAK never made.
    admiraltyReliability: null,
    admiraltyAccuracy: null,
    location: null,
    locationPoint: pointOf(change),
    inputSource: INPUT_SOURCE.tak,
    ingestSourceId: ingestSourceId ?? null,
    sourceUri: sourceUriOf(change, mission),
    type: EVENT_TYPE.takMission,
    data: {
      mission,
      changeType: change.type ?? null,
      creatorUid: uid ?? null,
      contentUid: change.contentUid ?? null,
      cotType: change.details?.type ?? null,
      cotTypeLabel: symbol ?? null,
      callsign: change.details?.callsign ?? null,
      title: change.details?.title ?? null,
      iconsetPath: change.details?.iconsetPath ?? null,
      color: change.details?.color ?? null,
      filename: change.contentResource?.filename ?? null,
      fileSize: change.contentResource?.size ?? null,
      fileHash: change.contentResource?.hash ?? null,
    },
  };
};

/** Seconds of history to ask for, from where the last successful poll reached. */
const secagoFor = async (mission: string, now: number): Promise<number> => {
  const at = await getIngestCursor(cursorKey(mission));
  const since = at ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(since)) return MAX_CATCHUP_S;
  return Math.min(MAX_CATCHUP_S, Math.max(OVERLAP_S, (now - since) / 1000 + OVERLAP_S));
};

const pollMission = async (mission: string, source: IngestSourceRow): Promise<void> => {
  const now = Date.now();
  const changes = await missionChanges(mission, await secagoFor(mission, now));
  for (const change of changes) {
    // Null means we already have it: polls overlap on purpose.
    const row = await createEventIfNew(missionChangeToCreateInput(change, mission, source.id));
    if (!row) continue;
    countEvent(source.id);
    countEvent(MISSIONS);
  }
  // Only after the inserts: a crash mid-batch should re-read, not skip.
  await setIngestCursor(cursorKey(mission), new Date(now).toISOString());
};

const tick = async (): Promise<void> => {
  const wanted = missionsToPoll(await enabledIngestSources("tak"));
  if (wanted.size === 0) {
    setStatus(MISSIONS, "disabled");
    return;
  }
  let failure: string | undefined;
  for (const [mission, source] of wanted) {
    try {
      await pollMission(mission, source);
    } catch (err) {
      failure = `${mission}: ${err instanceof Error ? err.message : String(err)}`;
      // Per mission rather than per tick: one feed we cannot read must not stop
      // the ones we can.
      if (setStatus(source.id, "error", failure)) {
        logger.error({ err, mission }, "tak mission ingest: could not read the feed");
      } else {
        logger.debug({ err, mission }, "tak mission ingest: could not read the feed (unchanged)");
      }
      continue;
    }
    setStatus(source.id, "connected");
  }
  setStatus(MISSIONS, failure ? "error" : "connected", failure);
};

/**
 * Feeds this deployment's TAK user can see, for the settings page's picker.
 *
 * Typing a mission name is how you end up watching a feed that does not exist
 * and wondering why nothing arrives.
 */
export const availableMissions = async (): Promise<
  { name: string; description?: string; chatRoom?: string }[]
> => {
  const missions = await listMissions();
  return missions
    .filter((m): m is typeof m & { name: string } => Boolean(m.name))
    .map((m) => ({
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
      ...(m.chatRoom ? { chatRoom: m.chatRoom } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const startTakMissionIngest = (): (() => Promise<void>) => {
  if (!ENV.TAK_STREAM_HOST) {
    logger.info("tak mission ingest disabled (TAK_STREAM_HOST unset)");
    setStatus(MISSIONS, "disabled");
    return async () => {};
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const run = async (): Promise<void> => {
    while (!stopped) {
      try {
        await tick();
      } catch (err) {
        // enabledIngestSources failing, ie the database is down. The stream has
        // the same problem and the same answer: keep going.
        if (setStatus(MISSIONS, "error", String(err))) {
          logger.error({ err }, "tak mission ingest: poll failed");
        }
      }
      if (stopped) return;
      await new Promise((resolve) => {
        timer = setTimeout(resolve, POLL_INTERVAL_MS);
      });
    }
  };

  void run();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    setStatus(MISSIONS, "disabled");
  };
};
