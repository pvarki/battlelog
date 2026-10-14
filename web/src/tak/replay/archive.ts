import { type TakChange, toChange } from "../cot.ts";
import { fetchArchive } from "../rest.ts";
import { inSlices } from "../slices.ts";
import { archiveChunks, changeTime, mergeChanges, REPLAY_MAX_CHANGES } from "./replay.ts";

// Events stored just before the last fetch can reach the archive a little late.
const LATE_ARRIVAL_MS = 5 * 60_000;

type Span = { from: number; to: number };

/** TAK's archive fetched so far this session: every change between `from` and `to`. */
let cached: (Span & { changes: TakChange[] }) | undefined;

/** What to fetch so that `cached` plus it covers [start, end] in one unbroken span. */
export const spansToFetch = (have: Span | undefined, start: number, end: number): Span[] => {
  if (!have || start > have.to) return [{ from: start, to: end }];
  const spans: Span[] = [];
  if (end > have.to) spans.push({ from: have.to - LATE_ARRIVAL_MS, to: end });
  if (start < have.from) spans.push({ from: start, to: have.from });
  return spans;
};

/**
 * The archived changes from `start` to `end`, fetched newest first a day at a
 * time and kept for the session, so a longer window or a later visit fetches
 * only what's new. `from` is where they begin: later than `start` when the
 * change limit cut the oldest.
 */
export const loadReplayChanges = async (
  start: number,
  end: number,
  signal: AbortSignal,
  onProgress: (done: number) => void,
): Promise<{ changes: TakChange[]; from: number }> => {
  const keep = cached && start <= cached.to ? cached : undefined;
  const chunks = spansToFetch(keep, start, end).flatMap((s) => archiveChunks(s.from, s.to));
  let fetched: TakChange[] = [];
  /** Fetching stopped at the change limit here; anything older may have a gap after it. */
  let stoppedAt = Number.NEGATIVE_INFINITY;
  for (const [i, [from, to]] of chunks.entries()) {
    onProgress(i / chunks.length);
    const events = await fetchArchive(new Date(from), new Date(to), signal);
    await inSlices(
      events,
      (slice) => {
        fetched = fetched.concat(slice.flatMap((event) => toChange(event) ?? []));
      },
      signal,
    );
    if (fetched.length >= REPLAY_MAX_CHANGES) {
      stoppedAt = from;
      break;
    }
  }
  const kept = (keep?.changes ?? []).filter((change) => changeTime(change) >= stoppedAt);
  const changes = mergeChanges(kept, fetched);
  const covered = Math.min(start, keep?.from ?? start);
  const cut = stoppedAt > Number.NEGATIVE_INFINITY || changes.length === REPLAY_MAX_CHANGES;
  const from = cut ? (changes[0] ? changeTime(changes[0]) : end) : covered;
  cached = { from, to: Math.max(end, keep?.to ?? end), changes };
  return { changes, from };
};
