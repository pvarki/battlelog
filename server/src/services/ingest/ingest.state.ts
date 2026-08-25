import type { IngestStatus, IngestStatusName } from "./ingest.types.ts";

/**
 * In-memory status of every ingester, keyed by ingest source id (or by kind for
 * the transport itself, which is not tied to one source).
 *
 * The same idea as matrixrmapi exposing app.state.rooms as a readiness gate,
 * except surfaced to the operator rather than only checked internally: the
 * settings page shows it, so "the room is encrypted" or "TAK refused the
 * certificate" is visible instead of buried in logs.
 *
 * Deliberately not persisted. It describes this process right now, and a stale
 * status read from the DB after a restart would be a lie.
 */

/** Key for the transport-level status of a kind, as opposed to one source. */
export const transportKey = (kind: string): string => `transport:${kind}`;

const statuses = new Map<string, IngestStatus>();

const current = (key: string): IngestStatus =>
  statuses.get(key) ?? { status: "disabled", eventCount: 0 };

/**
 * Record a status. Returns true when `error` is something we had not already
 * reported, which is what the ingesters use to decide between logging a failure
 * loudly and logging the same failure again quietly — a reconnect loop against a
 * dependency that is simply absent should not emit a stack trace every 5s
 * forever.
 */
export const setStatus = (key: string, status: IngestStatusName, error?: string): boolean => {
  const prev = current(key);
  statuses.set(key, {
    ...prev,
    status,
    // Keep the previous error visible through a reconnect: knowing what it was
    // is the whole point, and a bare "connecting" tells nobody anything.
    lastError: error ?? prev.lastError,
  });
  return error !== undefined && error !== prev.lastError;
};

export const countEvent = (key: string, at: Date = new Date()): void => {
  const prev = current(key);
  statuses.set(key, { ...prev, lastEventAt: at.toISOString(), eventCount: prev.eventCount + 1 });
};

export const getStatus = (key: string): IngestStatus => current(key);
