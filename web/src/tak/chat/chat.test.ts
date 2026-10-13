// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { toChange } from "../cot.ts";
import { conversationOf, EVERYONE, newChatEvent, parseChat } from "./chat.ts";

const sender = { uid: "BattleLog-Eversti", callsign: "Eversti" };
const NOW = Date.UTC(2026, 9, 13, 12);

test("a message to All Chat Rooms is written as ATAK writes it", () => {
  const event = newChatEvent("Hello <all>", EVERYONE, sender, NOW, "m1");
  expect(event).toMatchObject({
    uid: "GeoChat.BattleLog-Eversti.All Chat Rooms.m1",
    type: "b-t-f",
    stale: NOW + 86_400_000,
  });
  expect(event.detail).toBe(
    '<__chat parent="RootContactGroup" groupOwner="false" messageId="m1" chatroom="All Chat Rooms" id="All Chat Rooms" senderCallsign="Eversti">' +
      '<chatgrp uid0="BattleLog-Eversti" uid1="All Chat Rooms" id="All Chat Rooms"/></__chat>' +
      '<link uid="BattleLog-Eversti" type="a-f-G-U-C" relation="p-p"/>' +
      '<remarks source="BAO.F.ATAK.BattleLog-Eversti" to="All Chat Rooms" time="2026-10-13T12:00:00.000Z">Hello &lt;all&gt;</remarks>',
  );
});

test("a direct message names its recipient for TAK Server to route by", () => {
  const event = newChatEvent("hi", { uid: "ANDROID-1", callsign: "KETTU" }, sender, NOW, "m2");
  expect(event.uid).toBe("GeoChat.BattleLog-Eversti.ANDROID-1.m2");
  expect(event.detail).toContain('chatroom="KETTU" id="ANDROID-1"');
  expect(event.detail).toContain(
    '<chatgrp uid0="BattleLog-Eversti" uid1="ANDROID-1" id="ANDROID-1"/>',
  );
  expect(event.detail).toContain('<marti><dest callsign="KETTU"/></marti>');
});

test("a sent message parses back to itself", () => {
  const message = parseChat(newChatEvent("Hello <all>", EVERYONE, sender, NOW, "m1"));
  expect(message).toEqual({
    id: "m1",
    roomId: "All Chat Rooms",
    roomName: "All Chat Rooms",
    senderUid: "BattleLog-Eversti",
    senderCallsign: "Eversti",
    text: "Hello <all>",
    time: NOW,
  });
});

test("a direct message to us is filed under its sender", () => {
  const event = newChatEvent(
    "hi",
    { uid: "BattleLog-Eversti", callsign: "Eversti" },
    {
      uid: "ANDROID-1",
      callsign: "KETTU",
    },
  );
  const message = parseChat(event);
  if (!message) throw new Error("expected a message");
  expect(conversationOf(message, "BattleLog-Eversti")).toEqual({
    uid: "ANDROID-1",
    callsign: "KETTU",
  });
  expect(conversationOf(message, "ANDROID-1")).toEqual({
    uid: "BattleLog-Eversti",
    callsign: "Eversti",
  });
});

test("chat is not a map item, and other events are not chat", () => {
  const event = newChatEvent("hi", EVERYONE, sender, NOW);
  expect(toChange(event)).toBeNull();
  expect(parseChat({ ...event, type: "b-t-f-d" })).toBeUndefined();
  expect(parseChat({ ...event, detail: "<remarks>no chat</remarks>" })).toBeUndefined();
});
