import { beforeEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../../app.ts";
import type { EventRow } from "../../db/schema.ts";
import { eventsEmitter } from "../../services/events/events.emitter.ts";
import {
  ConcurrentUpdateError,
  listEventsSince,
  REPLAY_LIMIT,
  updateEvent,
} from "../../services/events/events.service.ts";

// DB-free: the SSE handler only touches the DB through listEventsSince, and
// the 409 mapping only through updateEvent — mock those, keep the rest real.
vi.mock("../../services/events/events.service.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../services/events/events.service.ts")>();
  return { ...orig, listEventsSince: vi.fn(), updateEvent: vi.fn() };
});

const app = createApp();

// Valid, string-ordered UUIDs (UUIDv7 ordering is what the stream relies on).
const uid = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, "0")}`;

const makeRow = (id: string): EventRow => ({
  id,
  eventId: id,
  updateFor: null,
  createdBy: "handlers-test",
  updatedBy: null,
  createdAt: new Date(0),
  eventTime: null,
  header: `row ${id}`,
  tags: null,
  hcoeDomains: null,
  admiraltyReliability: null,
  admiraltyAccuracy: null,
  location: null,
  locationPoint: null,
  inputSource: null,
  sourceUri: null,
  type: null,
  data: null,
});

const readerOf = (res: Response) => {
  if (!res.body) throw new Error("SSE response has no body");
  return res.body.getReader();
};

const readStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  doneWhen: (text: string) => boolean,
  timeoutMs = 3000,
): Promise<{ text: string; closed: boolean }> => {
  const decoder = new TextDecoder();
  let text = "";
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`SSE read timeout; got:\n${text}`)), timeoutMs),
  );
  while (!doneWhen(text)) {
    const { value, done } = await Promise.race([reader.read(), timeout]);
    if (done) return { text, closed: true };
    text += decoder.decode(value, { stream: true });
  }
  return { text, closed: false };
};

const sentIds = (text: string) => [...text.matchAll(/^id: (.+)$/gm)].map((m) => m[1]);

beforeEach(() => {
  vi.mocked(listEventsSince).mockReset();
  vi.mocked(updateEvent).mockReset();
});

describe("GET /events/stream", () => {
  test("replays missed rows, dedupes live overlap, flushes buffered rows in order, unsubscribes on abort", async () => {
    const [r1, r2, r3] = [makeRow(uid(2)), makeRow(uid(3)), makeRow(uid(4))];
    let release!: (rows: EventRow[]) => void;
    vi.mocked(listEventsSince).mockReturnValue(new Promise((r) => (release = r)));

    const baseline = eventsEmitter.listenerCount("new");
    const res = await app.request("/api/v1/events/stream", {
      headers: { "last-event-id": uid(1) },
    });
    expect(res.status).toBe(200);
    const reader = readerOf(res);

    // Wait for the stream to subscribe, then emit live rows mid-replay:
    // r2 duplicates a replayed row, r3 is fresh and must arrive after replay.
    await vi.waitFor(() => expect(eventsEmitter.listenerCount("new")).toBe(baseline + 1));
    eventsEmitter.emitNew(r2);
    eventsEmitter.emitNew(r3);
    release([r1, r2]);

    const { text } = await readStream(reader, (t) => sentIds(t).length >= 3);
    expect(sentIds(text)).toEqual([r1.id, r2.id, r3.id]);

    // Cancelling the body is how a client disconnect reaches the stream here.
    await reader.cancel();
    await vi.waitFor(() => expect(eventsEmitter.listenerCount("new")).toBe(baseline));
  });

  test("closes the stream when replay fails, so the client reconnects and retries", async () => {
    vi.mocked(listEventsSince).mockRejectedValue(new Error("db down"));
    const baseline = eventsEmitter.listenerCount("new");

    const res = await app.request("/api/v1/events/stream", {
      headers: { "last-event-id": uid(1) },
    });
    const { text, closed } = await readStream(readerOf(res), () => false);
    expect(closed).toBe(true);
    expect(sentIds(text)).toEqual([]);
    expect(eventsEmitter.listenerCount("new")).toBe(baseline);
  });

  test("closes after a full replay page so the client pages through a large gap", async () => {
    const rows = Array.from({ length: REPLAY_LIMIT }, (_, i) => makeRow(uid(i + 10)));
    vi.mocked(listEventsSince).mockResolvedValue(rows);

    const res = await app.request("/api/v1/events/stream", {
      headers: { "last-event-id": uid(1) },
    });
    const { text, closed } = await readStream(readerOf(res), () => false, 10_000);
    expect(closed).toBe(true);
    expect(sentIds(text)).toHaveLength(REPLAY_LIMIT);
  });

  test("rejects malformed query params", async () => {
    const res = await app.request("/api/v1/events/stream?limit=abc");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid input format" });
  });
});

describe("PATCH /events/{eventId}", () => {
  test("maps ConcurrentUpdateError to 409", async () => {
    vi.mocked(updateEvent).mockRejectedValue(new ConcurrentUpdateError(uid(1)));
    const res = await app.request(`/api/v1/events/${uid(1)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ header: "y" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Event was updated concurrently; fetch the latest version and retry",
    });
  });
});
