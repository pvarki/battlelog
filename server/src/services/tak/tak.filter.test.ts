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

describe("keeping a feed without the automatic flood", () => {
  // The shapes a real net produces: a client's periodic self-report, and
  // something a person actually did.
  const pli = {
    uid: "ANDROID-1",
    type: "a-f-G-U-C",
    how: "m-g",
    callsign: "ALPHA-1",
    detail:
      '<detail><contact callsign="ALPHA-1"/><__group name="Cyan" role="Team Member"/></detail>',
  };
  const marker = {
    uid: "MARK-1",
    type: "a-h-G-U-C-I",
    how: "h-e",
    callsign: "VIHOLLINEN-1",
    role: "HQ",
    detail: '<detail><__group name="Cyan" role="HQ"/></detail>',
  };
  const chat = {
    uid: "GeoChat.x.RECON.1",
    type: "b-t-f",
    how: "h-g-i-g-o",
    chatRoom: "RECON",
    senderCallsign: "ALPHA-1",
    remarks: "Partio asemissa",
  };

  test('"produced by a person" drops the self-reports and keeps the rest', () => {
    const config = { hows: ["^h-"] };
    expect(matchesTakConfig(pli, config)).toBe(false);
    expect(matchesTakConfig(marker, config)).toBe(true);
    expect(matchesTakConfig(chat, config)).toBe(true);
  });

  test("an exclusion keeps a whole feed minus one type", () => {
    // The case every other field cannot express: everything in RECON except the
    // position reports.
    const config = { chatRooms: ["^RECON$"], excludeCotTypes: ["^a-f-G-U-C$"] };
    expect(matchesTakConfig(chat, config)).toBe(true);
    expect(matchesTakConfig({ ...pli, chatRoom: "RECON" }, config)).toBe(false);
  });

  test("an exclusion overrules an otherwise matching include", () => {
    expect(matchesTakConfig(pli, { cotTypes: ["^a-f-"], excludeCotTypes: ["^a-f-G-U-C$"] })).toBe(
      false,
    );
  });

  test("role selects traffic from HQ without naming callsigns", () => {
    const config = { roles: ["^HQ$"] };
    expect(matchesTakConfig(marker, config)).toBe(true);
    expect(matchesTakConfig(pli, config)).toBe(false);
  });

  test("an empty exclusion list excludes nothing", () => {
    // The mirror of an empty include list, which constrains nothing.
    expect(matchesTakConfig(pli, { excludeCotTypes: [] })).toBe(true);
  });
});
