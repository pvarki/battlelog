import { describe, expect, test } from "vitest";
import type { IngestSourceRow } from "../../db/schema.ts";
import type { TakSourceConfig } from "../ingest/ingest.types.ts";
import type { CotEvent } from "./tak.cot.ts";
import { matchesTakConfig, matchTakSource } from "./tak.filter.ts";

const chat: CotEvent = {
  uid: "GeoChat.x.RECON.1",
  type: "b-t-f",
  chatRoom: "RECON",
  senderCallsign: "ALPHA-1",
  destCallsign: "RECON",
  remarks: "contact",
  detail: '<detail><__chat chatroom="RECON"/></detail>',
};

const position: CotEvent = {
  uid: "ANDROID-x",
  type: "a-f-G-U-C",
  callsign: "BRAVO-2",
  detail: '<detail><contact callsign="BRAVO-2"/><__group role="HQ"/></detail>',
};

const source = (config: TakSourceConfig, id = "s1"): IngestSourceRow =>
  ({ id, kind: "tak", name: id, enabled: true, config }) as unknown as IngestSourceRow;

describe("matchesTakConfig", () => {
  test("a source with no constraints takes everything", () => {
    expect(matchesTakConfig(chat, {})).toBe(true);
    expect(matchesTakConfig(position, {})).toBe(true);
  });

  test("empty lists are the same as absent", () => {
    expect(matchesTakConfig(chat, { cotTypes: [], chatRooms: ["  "] })).toBe(true);
  });

  test("patterns are unanchored regexes, so a bare prefix still works", () => {
    expect(matchesTakConfig(position, { cotTypes: ["a-f-"] })).toBe(true);
    expect(matchesTakConfig(position, { cotTypes: ["a-h-"] })).toBe(false);
    expect(matchesTakConfig(chat, { cotTypes: ["a-f-", "b-t-f"] })).toBe(true);
  });

  test("anchors give an exact match", () => {
    expect(matchesTakConfig(chat, { chatRooms: ["^RECON$"] })).toBe(true);
    // Unanchored would also match RECON-2; anchored must not
    expect(matchesTakConfig({ ...chat, chatRoom: "RECON-2" }, { chatRooms: ["^RECON$"] })).toBe(
      false,
    );
    expect(matchesTakConfig({ ...chat, chatRoom: "RECON-2" }, { chatRooms: ["^RECON"] })).toBe(
      true,
    );
  });

  test("a regex expresses in one pattern what used to need a list", () => {
    expect(matchesTakConfig(position, { cotTypes: ["^a-[fh]-"] })).toBe(true);
    expect(matchesTakConfig(chat, { cotTypes: ["^a-[fh]-"] })).toBe(false);
    expect(matchesTakConfig(chat, { senderCallsigns: ["^(ALPHA|BRAVO)-\\d+$"] })).toBe(true);
    expect(matchesTakConfig(position, { senderCallsigns: ["^(ALPHA|BRAVO)-\\d+$"] })).toBe(true);
    expect(
      matchesTakConfig(
        { ...position, callsign: "CHARLIE-9" },
        { senderCallsigns: ["^(ALPHA|BRAVO)-\\d+$"] },
      ),
    ).toBe(false);
  });

  test("a pattern that will not compile matches nothing rather than throwing", () => {
    // The API rejects these on save; this only guards rows written before that.
    expect(matchesTakConfig(chat, { chatRooms: ["*bad("] })).toBe(false);
  });

  test("chatRooms pick one feed and exclude the others", () => {
    expect(matchesTakConfig(chat, { chatRooms: ["RECON"] })).toBe(true);
    expect(matchesTakConfig(chat, { chatRooms: ["FIRES"] })).toBe(false);
    // A position report has no chat room, so a room filter must exclude it
    expect(matchesTakConfig(position, { chatRooms: ["RECON"] })).toBe(false);
  });

  test("detailContains is how a client role gets selected", () => {
    expect(matchesTakConfig(position, { detailContains: ['role="HQ"'] })).toBe(true);
    expect(matchesTakConfig(position, { detailContains: ['role="Medic"'] })).toBe(false);
    expect(matchesTakConfig(chat, { detailContains: ['role="HQ"'] })).toBe(false);
  });

  test("senderCallsigns fall back to the contact callsign", () => {
    expect(matchesTakConfig(chat, { senderCallsigns: ["ALPHA-1"] })).toBe(true);
    expect(matchesTakConfig(position, { senderCallsigns: ["BRAVO-2"] })).toBe(true);
    expect(matchesTakConfig(position, { senderCallsigns: ["ALPHA-1"] })).toBe(false);
  });

  test("all constraints must hold, not any", () => {
    expect(matchesTakConfig(chat, { chatRooms: ["RECON"], cotTypes: ["b-t-f"] })).toBe(true);
    expect(matchesTakConfig(chat, { chatRooms: ["RECON"], cotTypes: ["a-f-"] })).toBe(false);
  });
});

describe("matchTakSource", () => {
  test("returns the first matching source, so overlaps do not duplicate", () => {
    const first = source({ chatRooms: ["RECON"] }, "first");
    const second = source({ cotTypes: ["b-t-f"] }, "second");
    expect(matchTakSource(chat, [first, second])?.id).toBe("first");
  });

  test("returns undefined when nothing wants the event", () => {
    expect(matchTakSource(position, [source({ chatRooms: ["RECON"] })])).toBeUndefined();
    expect(matchTakSource(position, [])).toBeUndefined();
  });
});
