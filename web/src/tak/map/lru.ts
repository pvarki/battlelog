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
