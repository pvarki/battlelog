// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { type CotEvent, toChange } from "../cot.ts";
import {
  type ChatRoom,
  chatRooms,
  directRoom,
  EVERYONE,
  newChatEvent,
  parseChat,
  roomOf,
  teamRoom,
} from "./chat.ts";

const sender = { uid: "BattleLog-Eversti", callsign: "Eversti" };
const NOW = Date.UTC(2026, 9, 13, 12);

const atakChat = (chat: string): CotEvent => ({
  ...newChatEvent("x", EVERYONE, sender, NOW),
  detail: `${chat}<remarks source="BAO.F.ATAK.ANDROID-1" time="2026-10-13T12:00:00Z">hei</remarks>`,
});

const group: ChatRoom = {
  kind: "group",
  id: "g-1",
  name: "Recon",
  members: [
    { uid: "ANDROID-1", callsign: "KETTU" },
    { uid: "ANDROID-2", callsign: "SUSI" },
  ],
  owned: true,
};

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
  const event = newChatEvent("hi", directRoom("ANDROID-1", "KETTU"), sender, NOW, "m2");
  expect(event.uid).toBe("GeoChat.BattleLog-Eversti.ANDROID-1.m2");
  expect(event.detail).toContain('chatroom="KETTU" id="ANDROID-1"');
  expect(event.detail).toContain(
    '<chatgrp uid0="BattleLog-Eversti" uid1="ANDROID-1" id="ANDROID-1"/>',
  );
  expect(event.detail).toContain('<marti><dest callsign="KETTU"/></marti>');
});

test("a team message goes to each team member under the team's room", () => {
  const cyan = { ...teamRoom("Cyan"), members: group.members };
  const event = newChatEvent("hi", cyan, sender, NOW, "m3");
  expect(event.detail).toContain(
    '<__chat parent="TeamGroups" groupOwner="false" messageId="m3" chatroom="Cyan" id="Cyan"',
  );
  expect(event.detail).toContain(
    '<chatgrp uid0="BattleLog-Eversti" uid1="ANDROID-1" uid2="ANDROID-2" id="Cyan"/>',
  );
  expect(event.detail).toContain('<marti><dest callsign="KETTU"/><dest callsign="SUSI"/></marti>');
});

test("a group message lists its members and is ours to own", () => {
  const event = newChatEvent("hi", group, sender, NOW, "m4");
  expect(event.detail).toContain(
    '<__chat parent="UserGroups" groupOwner="true" messageId="m4" chatroom="Recon" id="g-1"',
  );
  expect(event.detail).toContain(
    '<chatgrp uid0="BattleLog-Eversti" uid1="ANDROID-1" uid2="ANDROID-2" id="g-1"/>',
  );
  expect(parseChat(event)?.memberUids).toEqual(["BattleLog-Eversti", "ANDROID-1", "ANDROID-2"]);
});

test("a member without a known callsign is routed by uid", () => {
  const event = newChatEvent("hi", { ...group, members: [{ uid: "ANDROID-3" }] }, sender, NOW);
  expect(event.detail).toContain('<marti><dest uid="ANDROID-3"/></marti>');
});

test("a room with no one to deliver to is never sent to everyone", () => {
  expect(() => newChatEvent("hi", teamRoom("Cyan"), sender, NOW)).toThrow();
});

test("a sent message parses back to itself", () => {
  const message = parseChat(newChatEvent("Hello <all>", EVERYONE, sender, NOW, "m1"));
  expect(message).toEqual({
    id: "m1",
    kind: "all",
    roomId: "All Chat Rooms",
    roomName: "All Chat Rooms",
    senderUid: "BattleLog-Eversti",
    senderCallsign: "Eversti",
    text: "Hello <all>",
    time: NOW,
  });
});

test("ATAK's team, group and nested group messages are filed by their parent", () => {
  const team = parseChat(
    atakChat(
      '<__chat parent="TeamGroups" chatroom="Cyan" id="Cyan" senderCallsign="KETTU"><chatgrp uid0="ANDROID-1" uid1="BattleLog-Eversti" id="Cyan"/></__chat>',
    ),
  );
  expect(team && roomOf(team, sender.uid)).toEqual({
    kind: "team",
    id: "Cyan",
    name: "Cyan",
    members: [],
  });
  const nested = parseChat(
    atakChat(
      '<__chat parent="parent-group-uid" groupOwner="false" chatroom="Recon" id="g-2" senderCallsign="KETTU"><chatgrp uid0="ANDROID-1" uid1="BattleLog-Eversti" uid2="ANDROID-2" id="g-2"/></__chat>',
    ),
  );
  expect(nested && roomOf(nested, sender.uid)).toEqual({
    kind: "group",
    id: "g-2",
    name: "Recon",
    members: [{ uid: "ANDROID-1" }, { uid: "ANDROID-2" }],
  });
});

test("a direct message to us is filed under its sender", () => {
  const message = parseChat(
    newChatEvent("hi", directRoom(sender.uid, sender.callsign), {
      uid: "ANDROID-1",
      callsign: "KETTU",
    }),
  );
  if (!message) throw new Error("expected a message");
  expect(roomOf(message, sender.uid)).toEqual(directRoom("ANDROID-1", "KETTU"));
  expect(roomOf(message, "ANDROID-1")).toEqual(directRoom(sender.uid, sender.callsign));
});

test("rooms are listed by kind, delivering to whom they reach now", () => {
  const heard = parseChat(
    atakChat(
      '<__chat parent="UserGroups" chatroom="Recon" id="g-2" senderCallsign="KETTU"><chatgrp uid0="ANDROID-1" uid1="BattleLog-Eversti" uid2="ANDROID-9" id="g-2"/></__chat>',
    ),
  );
  if (!heard) throw new Error("expected a message");
  const rooms = chatRooms({
    messages: [heard],
    selfUid: sender.uid,
    team: "Cyan",
    contacts: [
      { uid: "ANDROID-2", callsign: "SUSI", team: "Cyan" },
      { uid: "ANDROID-3", callsign: "KARHU", team: "Red" },
    ],
    groups: [group],
  });
  expect(rooms.map((r) => `${r.kind}:${r.name}`)).toEqual([
    "all:All Chat Rooms",
    "team:Cyan",
    "group:Recon",
    "group:Recon",
    "direct:SUSI",
    "direct:KARHU",
  ]);
  expect(rooms[1]?.members).toEqual([{ uid: "ANDROID-2", callsign: "SUSI" }]);
  // KETTU spoke in the group but isn't on the picture now: addressed by uid, since the
  // callsign may have passed to someone else.
  expect(rooms[3]?.members).toEqual([
    { uid: "ANDROID-1", callsign: undefined },
    { uid: "ANDROID-9", callsign: undefined },
  ]);
});

test("chat is not a map item, and other events are not chat", () => {
  const event = newChatEvent("hi", EVERYONE, sender, NOW);
  expect(toChange(event)).toBeNull();
  expect(parseChat({ ...event, type: "b-t-f-d" })).toBeUndefined();
  expect(parseChat({ ...event, detail: "<remarks>no chat</remarks>" })).toBeUndefined();
});
