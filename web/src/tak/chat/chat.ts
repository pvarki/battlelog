import type { CotEvent } from "../cot.ts";
import { escapeXml, type Sender } from "../drawing/new-items.ts";
import { childNamed } from "../protocol/cot-event.ts";

/**
 * ATAK GeoChat (`b-t-f`), written the way ATAK writes it. A message goes to
 * a chat room, which for ATAK's everyone-room is "All Chat Rooms" and for a
 * direct message is the recipient's uid; TAK Server routes the latter by
 * `<marti><dest callsign>`.
 */

export const CHAT_TYPE = "b-t-f";
export const ALL_CHAT_ROOMS = "All Chat Rooms";

export type ChatMessage = {
  id: string;
  /** "All Chat Rooms", or the recipient's uid for a direct message. */
  roomId: string;
  roomName: string;
  senderUid: string;
  senderCallsign: string;
  text: string;
  time: number;
};

/** Who a message goes to: everyone, or one TAK user. */
export type ChatRecipient = { uid: string; callsign: string };

export const EVERYONE: ChatRecipient = { uid: ALL_CHAT_ROOMS, callsign: ALL_CHAT_ROOMS };

const DAY_MS = 86_400_000;
const UNKNOWN = 9_999_999;

export const newChatEvent = (
  text: string,
  to: ChatRecipient,
  sender: Sender,
  now = Date.now(),
  messageId: string = crypto.randomUUID(),
): CotEvent => {
  const direct = to.uid !== ALL_CHAT_ROOMS;
  const [room, roomId, from] = [escapeXml(to.callsign), escapeXml(to.uid), escapeXml(sender.uid)];
  const detail = [
    `<__chat parent="RootContactGroup" groupOwner="false" messageId="${messageId}" chatroom="${room}" id="${roomId}" senderCallsign="${escapeXml(sender.callsign)}">`,
    `<chatgrp uid0="${from}" uid1="${roomId}" id="${roomId}"/>`,
    "</__chat>",
    `<link uid="${from}" type="a-f-G-U-C" relation="p-p"/>`,
    `<remarks source="BAO.F.ATAK.${from}" to="${roomId}" time="${new Date(now).toISOString()}">${escapeXml(text)}</remarks>`,
    direct ? `<marti><dest callsign="${room}"/></marti>` : "",
  ].join("");
  return {
    uid: `GeoChat.${sender.uid}.${to.uid}.${messageId}`,
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
  const roomId = chat?.getAttribute("id");
  const senderUid =
    (chat && childNamed(chat, "chatgrp")?.getAttribute("uid0")) ||
    childNamed(doc.documentElement, "link")?.getAttribute("uid");
  if (!chat || !remarks || !roomId || !senderUid) return undefined;
  return {
    id: chat.getAttribute("messageId") || event.uid,
    roomId,
    roomName: chat.getAttribute("chatroom") || roomId,
    senderUid,
    senderCallsign: chat.getAttribute("senderCallsign") || senderUid,
    text: remarks.textContent ?? "",
    time: event.time,
  };
};

/**
 * The conversation a message belongs to, seen from `selfUid`: a direct
 * message to us is filed under whoever sent it.
 */
export const conversationOf = (message: ChatMessage, selfUid: string): ChatRecipient =>
  message.roomId === selfUid
    ? { uid: message.senderUid, callsign: message.senderCallsign }
    : { uid: message.roomId, callsign: message.roomName };
