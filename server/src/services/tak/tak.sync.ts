import { parseCot, splitEvents } from "./cot.ts";
import {
  DAY_MS,
  parseMissionList,
  type TakLog,
  type TakMission,
  type TakState,
} from "./tak.state.ts";

// Runs in the browser too (direct-to-TAK mode): no Node or server imports here.

/** GET a Marti REST path as text; TAK's 404 ("nothing in range") must read as "". */
export type GetText = (path: string) => Promise<string>;

const MISSION_POLL_MS = 30_000;

export const applyAll = (state: TakState, xml: string) => {
  for (const event of splitEvents(xml).events) {
    const change = parseCot(event);
    if (change) state.apply(change);
  }
};

const getArchive = (getText: GetText, start: Date, end: Date) => {
  // Drawings and deletes are only returned with isFiltered=false.
  const query = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
    isFiltered: "false",
  });
  return getText(`/Marti/api/cot/sa?${query}`);
};

const fetchMissions = async (getText: GetText, log: TakLog): Promise<TakMission[]> => {
  const list = parseMissionList(await getText("/Marti/api/missions"));
  return Promise.all(
    list.map(async (mission) => {
      try {
        const xml = await getText(`/Marti/api/missions/${encodeURIComponent(mission.name)}/cot`);
        const items = splitEvents(xml).events.flatMap((event) => {
          const change = parseCot(event);
          return change?.kind === "upsert" ? [change.feature] : [];
        });
        return { ...mission, readable: true, items };
      } catch (err) {
        // A password-protected or restricted mission must not hide all the others.
        log.warn({ err, mission: mission.name }, "tak mission contents unavailable");
        return { ...mission, readable: false, items: [] };
      }
    }),
  );
};

/** TAK caps archive queries at 24 h, so long-lived items need one query per day. */
export const backfill = async ({
  getText,
  state,
  days,
  isCurrent,
  log,
}: {
  getText: GetText;
  state: TakState;
  days: number;
  isCurrent: () => boolean;
  log: TakLog;
}) => {
  const now = Date.now();
  for (let day = days; day > 0 && isCurrent(); day--) {
    const start = new Date(now - day * DAY_MS);
    const end = new Date(now - (day - 1) * DAY_MS);
    try {
      const xml = await getArchive(getText, start, end);
      if (isCurrent()) applyAll(state, xml);
    } catch (err) {
      log.warn({ err, start }, "tak backfill window failed");
    }
  }
  log.info({ items: state.snapshot().length }, "tak backfill done");
};

/**
 * Mission (Data Sync) contents only change through REST, so poll them; a push
 * subscription would mean subscribing to each mission, which is a write. Each
 * poll starts only after the previous one settles, so a slow TAK can't stack
 * requests or let an older answer overwrite a newer one. Returns a stop function.
 */
export const pollMissions = (getText: GetText, state: TakState, log: TakLog): (() => void) => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      const missions = await fetchMissions(getText, log);
      if (!stopped) state.setMissions(missions);
    } catch (err) {
      log.warn({ err }, "tak mission poll failed");
    }
    if (!stopped) timer = setTimeout(() => void poll(), MISSION_POLL_MS);
  };
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
};
