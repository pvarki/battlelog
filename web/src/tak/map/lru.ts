/** Least-recently-used caches on a Map's insertion order: the first entry is the oldest. */

/** The entry for `key`, made the newest. */
export const touch = <K, V>(cache: Map<K, V>, key: K): V | undefined => {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
};

/** Stores `key` as the newest entry; returns the values pushed out over `max`, oldest first. */
export const remember = <K, V>(cache: Map<K, V>, key: K, value: V, max: number): V[] => {
  cache.delete(key);
  cache.set(key, value);
  const evicted: V[] = [];
  for (const [oldest, old] of cache) {
    if (cache.size <= max) break;
    cache.delete(oldest);
    evicted.push(old);
  }
  return evicted;
};

/** Up to `count` of `keys` (oldest first), skipping those still in use. */
export const oldestUnused = <K>(keys: Iterable<K>, count: number, inUse: ReadonlySet<K>): K[] => {
  const out: K[] = [];
  for (const key of keys) {
    if (out.length >= count) break;
    if (!inUse.has(key)) out.push(key);
  }
  return out;
};

/**
 * Whether `cache` may take a new entry: it has room, or its oldest entry has
 * gone unused for `idleMs`. Otherwise every entry is in use, and admitting one
 * more would push out another that is asked for again at once, round and round.
 */
export const canAdmit = <K>(
  cache: Map<K, unknown>,
  max: number,
  usedAt: ReadonlyMap<K, number>,
  now: number,
  idleMs: number,
): boolean => {
  if (cache.size < max) return true;
  const oldest = cache.keys().next().value as K;
  return now - (usedAt.get(oldest) ?? 0) > idleMs;
};
