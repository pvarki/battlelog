import { describe, expect, it, vi } from "vitest";
import type { EventResponse } from "./api.ts";
import { mergeEvents, relevantRows } from "./live-events.ts";

const row = (id: string, eventId: string): EventResponse =>
  ({ id, eventId, header: `h-${id}` }) as EventResponse;

describe("mergeEvents", () => {
  it("sorts newest first and dedupes by id", () => {
    const merged = mergeEvents([row("01a", "e1")], [row("01b", "e2"), row("01a", "e1")], 100);
    expect(merged.map((e) => e.id)).toEqual(["01b", "01a"]);
  });

  it("a newer version replaces its event regardless of arrival order", () => {
    const v2 = row("01c", "e1");
    expect(mergeEvents([row("01a", "e1")], [v2], 100)).toEqual([v2]);
    expect(mergeEvents([v2], [row("01a", "e1")], 100)).toEqual([v2]);
  });

  it("trims to limit, dropping the oldest", () => {
    const merged = mergeEvents([row("01a", "e1"), row("01b", "e2")], [row("01c", "e3")], 2);
    expect(merged.map((e) => e.id)).toEqual(["01c", "01b"]);
  });
});

describe("relevantRows", () => {
  it("keeps matches and new versions of shown events, drops the rest", () => {
    const current = [row("01a", "e1")];
    const incoming = [row("01b", "e1"), row("01c", "e2"), row("01d", "e3")];
    const match = (e: EventResponse) => e.eventId === "e3";
    // e1's new version passes (already shown), e2 is dropped, e3 matches.
    expect(relevantRows(current, incoming, match).map((e) => e.id)).toEqual(["01b", "01d"]);
    expect(relevantRows(current, incoming, undefined)).toEqual(incoming);
  });
});

// A stalled-but-open stream is the failure this state machine exists to catch:
// every widget keeps rendering last-known values and nothing looks wrong.
class FakeEventSource {
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 0;
  closed = false;
  private handlers = new Map<string, Set<(e: unknown) => void>>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    const set = this.handlers.get(type) ?? new Set();
    set.add(fn);
    this.handlers.set(type, set);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data?: unknown) {
    for (const fn of this.handlers.get(type) ?? []) fn({ data });
  }
}

describe("connection state", () => {
  it("goes live on open, reconnects a stalled stream, and reports down once EventSource quits", async () => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    // Fresh module: the stream and its state are module-level singletons.
    vi.resetModules();
    const { subscribeToConnectionState } = await import("./live-events.ts");

    const seen: string[] = [];
    const stop = subscribeToConnectionState((s) => seen.push(s));
    expect(seen).toEqual(["connecting"]);

    const instance = (i: number) => {
      const es = FakeEventSource.instances[i];
      if (!es) throw new Error(`no EventSource #${i} was opened`);
      return es;
    };

    const first = instance(0);
    first.readyState = 1;
    first.emit("open");
    expect(seen.at(-1)).toBe("live");

    // Server pings every 15s; silence past two of them means stalled, so the
    // stream is torn down and reopened rather than left quietly dead.
    vi.advanceTimersByTime(35_000);
    expect(seen.at(-1)).toBe("connecting");
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);

    // CLOSED means EventSource has given up retrying on its own.
    const second = instance(1);
    second.readyState = FakeEventSource.CLOSED;
    second.emit("error");
    expect(seen.at(-1)).toBe("down");

    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
