import { parseCot } from "@server/services/tak/cot.ts";
import { expect, test } from "vitest";
import { takprotoToCot } from "./tak-proto.ts";

// Captured from TAK 5.8's /takproto/1 while sending a circle and its delete over 8089.
const CIRCLE =
  "v6wDEpsDCgd1LWQtYy1jKhFibC13c3Byb2JlLWNpcmNsZTDt95GqkjQ40t2RqpI0QJKttqqSNEoDaC1lUXL5D+m3v05AWYlBYOXQwjdAaQAAAODPEmNBcQAAAODPEmNBer4CCqUCPHNoYXBlPjxlbGxpcHNlIG1ham9yPSIyMDAwIiBtaW5vcj0iMjAwMCIgYW5nbGU9IjM2MCIvPjwvc2hhcGU+PHN0cm9rZUNvbG9yIHZhbHVlPSItNjU1MzYiLz48c3Ryb2tlV2VpZ2h0IHZhbHVlPSIzIi8+PGZpbGxDb2xvciB2YWx1ZT0iMTM1ODg4ODk2MCIvPjxyZW1hcmtzPkJhdHRsZUxvZyBXZWJTb2NrZXQgcHJvYmUsIHNhZmUgdG8gZGVsZXRlPC9yZW1hcmtzPjxfZmxvdy10YWdzXyBUQUstU2VydmVyLTM1NzQ4ZmJiOTU0ODQyMTk4NmFiZjk3MGZjZjc2NTBmPSIyMDI2LTEwLTEwVDEwOjAzOjI3LjU5N1oiLz4SFBISQkwgV1MgcHJvYmUgY2lyY2xlGO33kaqSNCDt95GqkjQ="; // pragma: allowlist secret
const DELETE =
  "v4kCEvgBCgd0LXgtZC1kKhVibC13c3Byb2JlLWNpcmNsZS1kZWww9dSSqpI0OOzUkqqSNECyspWqkjRKCWgtZy1pLWctb2kAAADgzxJjQXEAAADgzxJjQXqjAQqgATxsaW5rIHVpZD0iYmwtd3Nwcm9iZS1jaXJjbGUiIHJlbGF0aW9uPSJub25lIiB0eXBlPSJub25lIi8+PF9fZm9yY2VkZWxldGUvPjxfZmxvdy10YWdzXyBUQUstU2VydmVyLTM1NzQ4ZmJiOTU0ODQyMTk4NmFiZjk3MGZjZjc2NTBmPSIyMDI2LTEwLTEwVDEwOjAzOjM5LjUwOVoiLz4Y9dSSqpI0IPPUkqqSNA=="; // pragma: allowlist secret

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

test("a TAK protobuf drawing becomes the same feature the XML stream gives", () => {
  const [xml] = takprotoToCot(bytes(CIRCLE)).events;
  const change = parseCot(xml ?? "");
  expect(change?.kind).toBe("upsert");
  if (change?.kind !== "upsert") return;
  expect(change.feature.id).toBe("bl-wsprobe-circle");
  expect(change.feature.geometry).toEqual({ type: "Point", coordinates: [23.761, 61.4978] });
  expect(change.feature.properties).toMatchObject({
    cotType: "u-d-c-c",
    callsign: "BL WS probe circle",
    radius: 2000,
    remarks: "BattleLog WebSocket probe, safe to delete",
    stale: "2026-10-10T10:13:24.242Z",
  });
});

test("a truncated message after a good one keeps the good one", () => {
  const { events, error } = takprotoToCot(Uint8Array.from([...bytes(DELETE), 0xbf, 0x40, 0x12]));
  expect(events).toHaveLength(1);
  expect(error).toBeInstanceOf(Error);
});

test("a protobuf delete becomes a delete of the linked item", () => {
  const [xml] = takprotoToCot(bytes(DELETE)).events;
  expect(parseCot(xml ?? "")).toMatchObject({ kind: "delete", uid: "bl-wsprobe-circle" });
});

test("contact, group, status and takv sub-messages come back as CoT detail", () => {
  const enc = new TextEncoder();
  const str = (field: number, s: string) => [
    (field << 3) | 2,
    enc.encode(s).length,
    ...enc.encode(s),
  ];
  const msg = (field: number, body: number[]) => [(field << 3) | 2, body.length, ...body];
  const detail = msg(15, [
    ...msg(2, str(2, 'Al "Ace"')),
    ...msg(3, [...str(1, "Cyan"), ...str(2, "Team Lead")]),
    ...msg(5, [8, 77]),
    ...msg(6, [...str(2, "ATAK-CIV"), ...str(4, "5.8")]),
  ]);
  const cot = [...str(1, "a-f-G-U-C"), ...str(5, "u1"), ...detail];
  const takMessage = msg(2, cot);
  const [xml] = takprotoToCot(Uint8Array.from([0xbf, takMessage.length, ...takMessage])).events;
  const change = parseCot(xml ?? "");
  expect(change?.kind === "upsert" && change.feature.properties).toMatchObject({
    callsign: 'Al "Ace"',
    team: "Cyan",
    role: "Team Lead",
    battery: 77,
    device: "ATAK-CIV 5.8",
  });
});
