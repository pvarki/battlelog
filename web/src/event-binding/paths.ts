const keys = (path: string) => path.split(".");

export const getPath = (data: unknown, path: string): unknown => {
  let v = data;
  for (const key of keys(path)) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
};

/**
 * Immutable set at a dot path; missing objects along it are created. Arrays
 * stay arrays (`crew.0.name`): PATCH replaces `data` wholesale, so turning
 * one into an index-keyed object would corrupt the event.
 */
export const setPath = (data: unknown, path: string, value: unknown): unknown => {
  const [head = "", ...rest] = keys(path);
  const next = rest.length
    ? setPath((data as Record<string, unknown> | null | undefined)?.[head], rest.join("."), value)
    : value;
  if (Array.isArray(data)) {
    const copy = [...data];
    copy[Number(head)] = next;
    return copy;
  }
  return { ...(data !== null && typeof data === "object" ? data : {}), [head]: next };
};

export type BoundValue = string | number | boolean | null;

export type BoundState =
  | { state: "loading" }
  | { state: "missing-event" }
  | { state: "missing-field" }
  /** `null`: the field exists but is empty — settable, unlike a field absent from the data. */
  | { state: "ok"; value: BoundValue };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isEventId = (id: string): boolean => UUID.test(id);

/** `head`: undefined while loading, null when the event does not exist. */
export const resolveBound = (
  head: { data?: unknown } | null | undefined,
  eventId: string,
  field: string,
): BoundState => {
  if (!isEventId(eventId) || head === null) return { state: "missing-event" };
  if (head === undefined) return { state: "loading" };
  const value = getPath(head.data, field.trim());
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? { state: "ok", value }
    : { state: "missing-field" };
};

/** Section header: the scalar at `labelField` when the event has one, else its `header`. */
export const eventLabel = (
  event: { header: string; data?: unknown },
  labelField: string,
): string => {
  const value = labelField.trim() ? getPath(event.data, labelField.trim()) : undefined;
  return (typeof value === "string" || typeof value === "number") && String(value).trim()
    ? String(value)
    : event.header;
};
