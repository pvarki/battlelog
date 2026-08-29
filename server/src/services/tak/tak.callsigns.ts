/**
 * uid → callsign, learned from the CoT stream.
 *
 * The mission change log names its author by device uid ("ANDROID-9f3c…"),
 * which is no use in a feed anyone reads. The stream carries the mapping for
 * free: every client's own position report has both its uid and its
 * <contact callsign>. So remember what goes past and look it up when the
 * mission poller needs a name.
 *
 * ponytail: in memory, so a name is unknown until that client has reported once
 * since boot — the mapper falls back to the uid. Persisting it would survive
 * restarts; not worth a table until someone finds a raw uid in the log and
 * minds.
 */

/** Bounded so a long-lived process cannot accumulate every device that ever connected. */
const MAX_ENTRIES = 1_000;

const byUid = new Map<string, string>();

export const rememberCallsign = (uid: string, callsign: string | undefined): void => {
  if (!callsign || !uid) return;
  // Re-insert so the entry counts as recently seen: Map iterates in insertion
  // order, which is what makes the eviction below drop the stalest.
  byUid.delete(uid);
  byUid.set(uid, callsign);
  if (byUid.size > MAX_ENTRIES) {
    const oldest = byUid.keys().next();
    if (!oldest.done) byUid.delete(oldest.value);
  }
};

export const callsignFor = (uid: string | undefined): string | undefined =>
  uid ? byUid.get(uid) : undefined;
