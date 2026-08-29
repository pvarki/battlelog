import { describe, expect, test } from "vitest";
import type { IngestSourceRow } from "../../db/schema.ts";
import { countEvent, setStatus, transportKey } from "../../services/ingest/ingest.state.ts";
import { toApiIngestSource } from "./ingest.apiSchema.ts";

const row = (over: Partial<IngestSourceRow> = {}): IngestSourceRow =>
  ({
    id: "01920000-0000-7000-8000-0000000000aa",
    kind: "tak",
    name: "HQ tracks",
    enabled: true,
    config: {},
    createdBy: "test",
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as IngestSourceRow;

describe("toApiIngestSource status", () => {
  test("a TAK source reports the transport's connection state", () => {
    // TAK has one socket shared by every TAK source, so nothing ever set a
    // status under the source's own id and every row displayed "Off" for ever —
    // which is exactly how a healthy stream looked in production.
    setStatus(transportKey("tak"), "connected");
    expect(toApiIngestSource(row()).status.status).toBe("connected");

    setStatus(transportKey("tak"), "error", "TAK refused the certificate");
    const errored = toApiIngestSource(row()).status;
    expect(errored.status).toBe("error");
    expect(errored.lastError).toBe("TAK refused the certificate");
  });

  test("but keeps its own counters, which are genuinely per-source", () => {
    const r = row({ id: "01920000-0000-7000-8000-0000000000bb" });
    setStatus(transportKey("tak"), "connected");
    countEvent(r.id);
    countEvent(r.id);
    const status = toApiIngestSource(r).status;
    expect(status.eventCount).toBe(2);
    expect(status.lastEventAt).toBeDefined();
  });

  test("a Matrix source keeps its own status, because a room can differ", () => {
    const r = row({ id: "01920000-0000-7000-8000-0000000000cc", kind: "matrix" });
    setStatus(transportKey("tak"), "connected");
    setStatus(r.id, "not-joined", "Invite the bot to this room");
    expect(toApiIngestSource(r).status.status).toBe("not-joined");
  });
});
