import "varlock/auto-load";
import { ENV } from "varlock/env";
import { describe, expect, test } from "vitest";
import { createApp } from "../../app.ts";
import type { CotChange } from "../../services/tak/cot.ts";
import { takState } from "../../services/tak/tak.state.ts";

const app = createApp();

const marker = (id: string): CotChange => ({
  kind: "upsert",
  feature: {
    type: "Feature",
    id,
    geometry: { type: "Point", coordinates: [24.9, 60.2] },
    properties: {
      cotType: "a-u-G",
      callsign: id,
      time: new Date().toISOString(),
      stale: "2099-01-01T00:00:00.000Z",
    },
  },
});

const readUntil = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  done: (text: string) => boolean,
) => {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 3000;
  while (!done(text)) {
    if (Date.now() > deadline) throw new Error(`SSE read timeout; got:\n${text}`);
    const { value, done: ended } = await reader.read();
    if (ended) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
};

describe("tak routes", () => {
  test("GET /tak/state returns the current picture under /api and /api/v1", async () => {
    takState.apply(marker("routes-state"));
    for (const base of ["/api", "/api/v1"]) {
      const res = await app.request(`${base}/tak/state`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(ENV.TAK_ENABLED);
      expect(body.items.map((f: { id: string }) => f.id)).toContain("routes-state");
    }
  });

  test("GET /tak/missions lists missions", async () => {
    takState.setMissions([{ name: "ROUTES-LIST", keywords: ["#x"], items: [] }]);
    const res = await app.request("/api/v1/tak/missions");
    expect(await res.json()).toEqual([{ name: "ROUTES-LIST", keywords: ["#x"], items: [] }]);
  });

  test("stream sends the snapshot, then live upserts and deletes", async () => {
    takState.apply(marker("routes-before"));
    const res = await app.request("/api/v1/tak/stream");
    if (!res.body) throw new Error("SSE response has no body");
    const reader = res.body.getReader();
    expect(await readUntil(reader, (t) => t.includes("event: snapshot"))).toContain(
      "routes-before",
    );

    takState.apply(marker("routes-live"));
    takState.apply({
      kind: "delete",
      uid: "routes-live",
      time: new Date(Date.now() + 1000).toISOString(),
    });
    const rest = await readUntil(reader, (t) => t.includes("event: delete"));
    expect(rest).toContain("event: upsert");
    expect(rest).toContain('"id":"routes-live"');
    await reader.cancel();
  });
});
