import { type UseStorageOptions, useLocalStorage } from "@mantine/hooks";

const kind = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

/**
 * A stored value that isn't JSON, or is of another kind than the default (an
 * object where a list belongs, from a bad settings file or an old version),
 * reads as the default instead of breaking whatever reads it.
 * ponytail: checks the top-level kind only; a per-setting schema if nested shapes start breaking.
 */
export const readLike = <T>(raw: string | undefined, fallback: T): T => {
  if (raw === undefined) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    return fallback == null || kind(value) === kind(fallback) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
};

/** `useLocalStorage` for a setting, falling back to its default when the stored value doesn't fit. */
export const useStoredSetting = <T>(options: UseStorageOptions<T> & { defaultValue: T }) =>
  useLocalStorage<T>({ ...options, deserialize: (raw) => readLike(raw, options.defaultValue) });
