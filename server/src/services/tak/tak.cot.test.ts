import { describe, expect, test } from "vitest";
import { extractCotEvents, parseCotEvent } from "./tak.cot.ts";

/**
 * The <event>/<point> shape is fixed by the CoT schema, so those assertions hold
 * for any producer. The <detail> subtree is free-form and what ATAK actually puts
 * in a GeoChat varies by version — re-capture these two fixtures off a live TAK
 * 5.7 stream (blapi logs unparseable CoT at warn, and every event at debug)
 * before trusting the chat field mapping in production.
 */

const CHAT_COT = `<event version="2.0" uid="GeoChat.ANDROID-x.RECON.abc" type="b-t-f" how="h-g-i-g-o" time="2026-08-25T10:00:00.000Z" start="2026-08-25T10:00:00.000Z" stale="2026-08-25T10:05:00.000Z"><point lat="60.1699" lon="24.9384" hae="12.5" ce="9999999.0" le="9999999.0"/><detail><__chat parent="RootContactGroup" groupOwner="false" chatroom="RECON" id="RECON" senderCallsign="ALPHA-1"><chatgrp uid0="ANDROID-x" uid1="RECON" id="RECON"/></__chat><link uid="ANDROID-x" type="a-f-G-U-C" relation="p-p"/><remarks source="BAO.F.ATAK.ANDROID-x" time="2026-08-25T10:00:00.000Z">Two vehicles at the crossroads</remarks><__serverdestination destinations="10.0.0.5:4242:tcp"/></detail></event>`;

const POSITION_COT = `<event version="2.0" uid="ANDROID-x" type="a-f-G-U-C" how="m-g" time="2026-08-25T10:01:00.000Z" start="2026-08-25T10:01:00.000Z" stale="2026-08-25T10:03:00.000Z"><point lat="60.2" lon="24.8" hae="30.0" ce="7.5" le="9999999.0"/><detail><contact endpoint="*:-1:stcp" callsign="BRAVO-2"/><__group role="HQ" name="Cyan"/><takv device="Pixel" platform="ATAK-CIV" os="34" version="5.1"/><status battery="88"/></detail></event>`;

describe("extractCotEvents", () => {
  test("splits a stream on the closing tag and keeps the partial", () => {
    const { events, remaining } = extractCotEvents(`${CHAT_COT}${POSITION_COT}<event uid="hal`);
    expect(events).toEqual([CHAT_COT, POSITION_COT]);
    expect(remaining).toBe('<event uid="hal');
  });

  test("drops junk before the first event rather than choking on it", () => {
    // A reconnect can leave us mid-element, and TAK sometimes prepends a decl.
    const { events } = extractCotEvents(`ignored trailing garbage</event>${CHAT_COT}`);
    expect(events).toEqual([CHAT_COT]);
  });

  test("does not grow the buffer without bound for a peer that never closes", () => {
    const { events, remaining } = extractCotEvents("<event ".padEnd(1_000_002, "x"));
    expect(events).toEqual([]);
    expect(remaining).toBe("");
  });
});

describe("parseCotEvent", () => {
  test("reads a GeoChat message", () => {
    const cot = parseCotEvent(CHAT_COT);
    expect(cot).toBeDefined();
    expect(cot?.uid).toBe("GeoChat.ANDROID-x.RECON.abc");
    expect(cot?.type).toBe("b-t-f");
    expect(cot?.time?.toISOString()).toBe("2026-08-25T10:00:00.000Z");
    expect(cot?.lat).toBe(60.1699);
    expect(cot?.lon).toBe(24.9384);
    expect(cot?.chatRoom).toBe("RECON");
    expect(cot?.senderCallsign).toBe("ALPHA-1");
    expect(cot?.destCallsign).toBe("RECON");
    expect(cot?.remarks).toBe("Two vehicles at the crossroads");
  });

  test("reads a position report and keeps detail verbatim for filtering", () => {
    const cot = parseCotEvent(POSITION_COT);
    expect(cot?.callsign).toBe("BRAVO-2");
    expect(cot?.chatRoom).toBeUndefined();
    expect(cot?.remarks).toBeUndefined();
    // The whole reason detail is kept as a string: a client's role exists only
    // in here, so a substring is the only way to select on it.
    expect(cot?.detail).toContain('role="HQ"');
    expect(cot?.detail?.startsWith("<detail")).toBe(true);
    expect(cot?.detail?.endsWith("</detail>")).toBe(true);
  });

  test("returns undefined instead of throwing on unusable input", () => {
    expect(parseCotEvent("<event>no uid or type</event>")).toBeUndefined();
    expect(parseCotEvent("not xml at all")).toBeUndefined();
    expect(parseCotEvent("<event uid=unclosed")).toBeUndefined();
  });

  test("handles an event with no detail at all", () => {
    const cot = parseCotEvent(
      '<event uid="u" type="a-f" time="2026-08-25T10:00:00Z"><point lat="1" lon="2"/></event>',
    );
    expect(cot?.detail).toBeUndefined();
    expect(cot?.uid).toBe("u");
  });
});
