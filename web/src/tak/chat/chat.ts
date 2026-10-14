import type { CotEvent } from "../cot.ts";
import { escapeXml, type Sender } from "../drawing/new-items.ts";
import { childNamed } from "../protocol/cot-event.ts";

/**
 * ATAK GeoChat (`b-t-f`), written the way ATAK writes it. A message goes to
 * a chat room: ATAK's everyone-room "All Chat Rooms", a team's room (named
 * after the team), a user group (its own uid), or for a direct message the
 * recipient's uid. All but the everyone-room are delivered only to their
 * members, which TAK Server routes by `<marti><dest>`.
 */

export const CHAT_TYPE = "b-t-f";
export const ALL_CHAT_ROOMS = "All Chat Rooms";

export type ChatKind = "all" | "team" | "group" | "direct";

export type ChatMessage = {
  id: string;
  kind: ChatKind;
  /** "All Chat Rooms", the team name, the group uid, or the recipient's uid. */
  roomId: string;
  roomName: string;
  /** A group's members as the message lists them, the sender included. */
  memberUids?: string[];
  senderUid: string;
  senderCallsign: string;
  text: string;
  time: number;
};

/** A TAK user a room delivers to; without a callsign TAK Server is asked to route by uid. */
export type ChatMember = { uid: string; callsign?: string };

export type ChatRoom = {
  kind: ChatKind;
  id: string;
  name: string;
  /** Everyone it's delivered to but us; empty for All Chat Rooms. */
  members: ChatMember[];
  /** A group this browser created. */
  owned?: boolean;
};

/** A TAK user as chat knows them from the live picture. */
export type ChatContact = { uid: string; callsign: string; team?: string };

export const EVERYONE: ChatRoom = {
  kind: "all",
  id: ALL_CHAT_ROOMS,
  name: ALL_CHAT_ROOMS,
  members: [],
};

export const directRoom = (uid: string, callsign: string): ChatRoom => ({
  kind: "direct",
  id: uid,
  name: callsign,
  members: [{ uid, callsign }],
});

export const teamRoom = (team: string): ChatRoom => ({
  kind: "team",
  id: team,
  name: team,
  members: [],
});

export const roomKey = (room: Pick<ChatRoom, "kind" | "id">) => `${room.kind}:${room.id}`;

const ROOT_PARENT = "RootContactGroup";
const PARENTS: Record<ChatKind, string> = {
  all: ROOT_PARENT,
  direct: ROOT_PARENT,
  team: "TeamGroups",
  group: "UserGroups",
};
// Anyone on TAK can send chat; a group's member list is theirs to inflate.
const MAX_MEMBERS = 100;
const DAY_MS = 86_400_000;
const UNKNOWN = 9_999_999;

const destOf = ({ uid, callsign }: ChatMember) =>
  callsign ? `<dest callsign="${escapeXml(callsign)}"/>` : `<dest uid="${escapeXml(uid)}"/>`;

export const newChatEvent = (
  text: string,
  room: ChatRoom,
  sender: Sender,
  now = Date.now(),
  messageId: string = crypto.randomUUID(),
): CotEvent => {
  // Without a dest TAK Server would deliver it to everyone.
  if (room.kind !== "all" && room.members.length === 0) {
    throw new Error(`No one to deliver ${room.name} to`);
  }
  const groupUids = room.kind === "all" ? [ALL_CHAT_ROOMS] : room.members.map((m) => m.uid);
  const chatgrp = [sender.uid, ...groupUids]
    .map((uid, i) => ` uid${i}="${escapeXml(uid)}"`)
    .join("");
  const [roomId, from] = [escapeXml(room.id), escapeXml(sender.uid)];
  const dests = room.members.map(destOf).join("");
  const detail = [
    `<__chat parent="${PARENTS[room.kind]}" groupOwner="${!!room.owned}" messageId="${messageId}" chatroom="${escapeXml(room.name)}" id="${roomId}" senderCallsign="${escapeXml(sender.callsign)}">`,
    `<chatgrp${chatgrp} id="${roomId}"/>`,
    "</__chat>",
    `<link uid="${from}" type="a-f-G-U-C" relation="p-p"/>`,
    `<remarks source="BAO.F.ATAK.${from}" to="${roomId}" time="${new Date(now).toISOString()}">${escapeXml(text)}</remarks>`,
    dests ? `<marti>${dests}</marti>` : "",
  ].join("");
  return {
    uid: `GeoChat.${sender.uid}.${room.id}.${messageId}`,
    type: CHAT_TYPE,
    how: "h-g-i-g-o",
    time: now,
    start: now,
    stale: now + DAY_MS,
    // The browser has no position of its own; ATAK sends its own here.
    lat: 0,
    lon: 0,
    hae: UNKNOWN,
    ce: UNKNOWN,
    le: UNKNOWN,
    detail,
  };
};

// ATAK names a nested user group's parent group as its `parent`, so any parent it isn't sure of is a group.
const kindOf = (roomId: string, parent: string | null): ChatKind =>
  roomId === ALL_CHAT_ROOMS
    ? "all"
    : parent === PARENTS.team
      ? "team"
      : !parent || parent === ROOT_PARENT
        ? "direct"
        : "group";

/** The chat message in a `b-t-f` event; undefined for anything else. */
export const parseChat = (event: CotEvent): ChatMessage | undefined => {
  if (event.type !== CHAT_TYPE) return undefined;
  const doc = new DOMParser().parseFromString(
    `<detail>${event.detail}</detail>`,
    "application/xml",
  );
  if (doc.getElementsByTagName("parsererror").length > 0) return undefined;
  const chat = childNamed(doc.documentElement, "__chat");
  const remarks = childNamed(doc.documentElement, "remarks");
  const chatgrp = chat && childNamed(chat, "chatgrp");
  const roomId = chat?.getAttribute("id");
  const senderUid =
    chatgrp?.getAttribute("uid0") || childNamed(doc.documentElement, "link")?.getAttribute("uid");
  if (!chat || !remarks || !roomId || !senderUid) return undefined;
  const kind = kindOf(roomId, chat.getAttribute("parent"));
  const memberUids =
    kind === "group" && chatgrp
      ? [...chatgrp.attributes]
          .filter((a) => /^uid\d+$/.test(a.name) && a.value)
          .map((a) => a.value)
          .slice(0, MAX_MEMBERS)
      : undefined;
  return {
    id: chat.getAttribute("messageId") || event.uid,
    kind,
    roomId,
    roomName: chat.getAttribute("chatroom") || roomId,
    ...(memberUids && { memberUids }),
    senderUid,
    senderCallsign: chat.getAttribute("senderCallsign") || senderUid,
    text: remarks.textContent ?? "",
    time: event.time,
  };
};

/**
 * The room a message belongs to, seen from `selfUid`: a direct message to us
 * is filed under whoever sent it. Members are only as the message knows them.
 */
export const roomOf = (message: ChatMessage, selfUid: string): ChatRoom => {
  const { kind, roomId, roomName } = message;
  if (kind === "direct" && roomId === selfUid) {
    return directRoom(message.senderUid, message.senderCallsign);
  }
  if (kind === "direct") return directRoom(roomId, roomName);
  const members = (message.memberUids ?? [])
    .filter((uid) => uid !== selfUid)
    .map((uid) => ({ uid }));
  return { kind, id: roomId, name: roomName, members };
};

const KIND_ORDER: ChatKind[] = ["all", "team", "group", "direct"];

/**
 * Every room to show: All Chat Rooms, our team's, the groups we made or
 * heard from, then direct conversations, each with whom it delivers to now.
 */
export const chatRooms = ({
  messages,
  selfUid,
  team,
  contacts,
  groups,
}: {
  messages: ChatMessage[];
  selfUid: string;
  team: string;
  contacts: ChatContact[];
  /** Groups made in this browser. */
  groups: ChatRoom[];
}): ChatRoom[] => {
  // Members are addressed by their callsign as it is now, or by uid when they aren't on the
  // picture: a saved or overheard callsign may since belong to someone else.
  const callsigns = new Map(contacts.map((c) => [c.uid, c.callsign]));
  // A group's newest message has its current members.
  const newestFirst = messages.toReversed().map((m) => roomOf(m, selfUid));
  const contactRooms = contacts.map((c) => directRoom(c.uid, c.callsign));
  const rooms = new Map<string, ChatRoom>();
  for (const room of [EVERYONE, teamRoom(team), ...groups, ...newestFirst, ...contactRooms]) {
    if (!rooms.has(roomKey(room))) rooms.set(roomKey(room), room);
  }
  const membersOf = (room: ChatRoom): ChatMember[] =>
    room.kind === "team"
      ? contacts.filter((c) => c.team === room.id).map(({ uid, callsign }) => ({ uid, callsign }))
      : room.members.map((m) => ({ uid: m.uid, callsign: callsigns.get(m.uid) }));
  return [...rooms.values()]
    .map((room) => ({ ...room, members: membersOf(room) }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
};
