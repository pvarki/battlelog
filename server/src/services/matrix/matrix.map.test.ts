import { describe, expect, test } from "vitest";
import { matrixEventToCreateInput, parseGeoUri, senderIdentity } from "./matrix.map.ts";

const ctx = {
  roomId: "!feed:golden-monkey.test",
  roomName: "95-Feed",
  serverDomain: "golden-monkey.test",
};

const message = {
  type: "m.room.message",
  event_id: "$abc123",
  sender: "@alpha1:golden-monkey.test",
  origin_server_ts: 1_800_000_000_000,
  content: { msgtype: "m.text", body: "Two vehicles at the crossroads" },
};

describe("senderIdentity", () => {
  test("a local sender becomes their callsign", () => {
    expect(senderIdentity("@alpha1:golden-monkey.test", "golden-monkey.test")).toBe("alpha1");
  });

  test("a federated sender keeps the full MXID", () => {
    // Otherwise @alpha1:evil.example lands in created_by as plain "alpha1" and
    // reads as one of our own users.
    expect(senderIdentity("@alpha1:evil.example", "golden-monkey.test")).toBe(
      "@alpha1:evil.example",
    );
  });
});

describe("parseGeoUri", () => {
  test("returns [lng, lat]", () => {
    expect(parseGeoUri("geo:60.1699,24.9384;u=25")).toEqual([24.9384, 60.1699]);
    expect(parseGeoUri("geo:-33.86,151.2")).toEqual([151.2, -33.86]);
  });

  test("rejects nonsense rather than storing it", () => {
    expect(parseGeoUri("geo:")).toBeNull();
    expect(parseGeoUri("https://example.com")).toBeNull();
    expect(parseGeoUri("geo:91.0,0.0")).toBeNull();
  });
});

describe("matrixEventToCreateInput", () => {
  test("maps a text message", () => {
    const input = matrixEventToCreateInput(message, ctx);
    expect(input).not.toBeNull();
    expect(input?.header).toBe("Two vehicles at the crossroads");
    expect(input?.createdBy).toBe("alpha1");
    expect(input?.inputSource).toBe("matrix");
    expect(input?.type).toBe("matrix.message");
    expect(input?.eventTime).toEqual(new Date(1_800_000_000_000));
    expect(input?.tags).toEqual(["matrix", "95-Feed"]);
    expect(input?.sourceUri).toBe(
      "https://matrix.to/#/!feed%3Agolden-monkey.test/%24abc123?via=golden-monkey.test",
    );
  });

  test("header is one line, truncated, with the body kept whole", () => {
    const input = matrixEventToCreateInput(
      { ...message, content: { body: `first line\nsecond line`, msgtype: "m.text" } },
      ctx,
    );
    expect(input?.header).toBe("first line");
    expect((input?.data as { body?: string } | undefined)?.body).toBe("first line\nsecond line");

    const long = matrixEventToCreateInput(
      { ...message, content: { body: "y".repeat(400), msgtype: "m.text" } },
      ctx,
    );
    expect(long?.header).toHaveLength(200);
  });

  test("skips anything that is not a readable message", () => {
    expect(matrixEventToCreateInput({ ...message, type: "m.room.member" }, ctx)).toBeNull();
    expect(matrixEventToCreateInput({ ...message, type: "m.room.encrypted" }, ctx)).toBeNull();
    // Redaction strips content, which is how a redacted message arrives
    expect(matrixEventToCreateInput({ ...message, content: {} }, ctx)).toBeNull();
    expect(matrixEventToCreateInput({ ...message, content: { body: "   " } }, ctx)).toBeNull();
    expect(matrixEventToCreateInput({ ...message, event_id: undefined }, ctx)).toBeNull();
  });

  test("an m.location message carries its point through", () => {
    const input = matrixEventToCreateInput(
      {
        ...message,
        content: { msgtype: "m.location", body: "Rally point", geo_uri: "geo:60.17,24.94" },
      },
      ctx,
    );
    expect(input?.locationPoint).toEqual([24.94, 60.17]);
  });
});
