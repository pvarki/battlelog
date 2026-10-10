import { type ContentHelpers, type MatrixEvent, MsgType } from "matrix-js-sdk";

export type RoomMessageEventContent = ReturnType<typeof ContentHelpers.makeHtmlMessage>;

export type Mention = { userId: string; name: string };

/** The message this one replies to (`m.in_reply_to`), if any. */
export type ReplyTarget = { eventId: string; senderId: string };

/** Thread to post into: its root, and its newest message for the reply fallback. */
export type ThreadTarget = { rootId: string; latestEventId: string };

/** `m.relates_to`. Encrypted rooms carry it on the outer (wire) content, not the decrypted one. */
export type RelatesTo = {
  rel_type?: string;
  event_id?: string;
  is_falling_back?: boolean;
  "m.in_reply_to"?: { event_id?: string };
};

type MessageContent = { msgtype?: string; body?: unknown };

export const relatesToOf = (ev: MatrixEvent): RelatesTo | undefined =>
  ev.getWireContent()["m.relates_to"];

/** A thread message's `m.in_reply_to` is only a fallback for thread-unaware clients unless it says otherwise. */
export const replyToId = (relatesTo: RelatesTo | undefined): string | undefined => {
  if (relatesTo?.rel_type === THREAD && relatesTo.is_falling_back !== false) return undefined;
  return relatesTo?.["m.in_reply_to"]?.event_id;
};

export const threadRootId = (relatesTo: RelatesTo | undefined): string | undefined =>
  relatesTo?.rel_type === THREAD ? relatesTo.event_id : undefined;

/**
 * Body text without the "> <@user> quoted…" fallback that pre-v1.13 clients
 * prepend to replies; we show the quote ourselves.
 */
export const displayBody = (content: MessageContent, isReply: boolean): string => {
  const body = typeof content.body === "string" ? content.body : "";
  return isReply ? body.replace(/^(?:>(?: [^\n]*)?\n)+\n?/, "") : body;
};

/** One-line summary for quotes and notifications. */
export const previewText = (content: MessageContent, isReply: boolean): string => {
  switch (content.msgtype) {
    case "m.image":
      return "sent an image";
    case "m.audio":
      return "sent audio";
    case "m.file":
    case "m.video":
      return "sent a file";
  }
  return displayBody(content, isReply).split("\n")[0]?.slice(0, 200) ?? "";
};

export const eventPreview = (ev: MatrixEvent) =>
  previewText(ev.getContent(), replyToId(relatesToOf(ev)) !== undefined);

const THREAD = "m.thread";

export const relationFor = (reply?: ReplyTarget, thread?: ThreadTarget) => {
  if (thread) {
    return {
      "m.relates_to": {
        rel_type: THREAD,
        event_id: thread.rootId,
        is_falling_back: !reply,
        "m.in_reply_to": { event_id: reply?.eventId ?? thread.latestEventId },
      },
    };
  }
  return reply ? { "m.relates_to": { "m.in_reply_to": { event_id: reply.eventId } } } : {};
};

/**
 * An `m.replace` edit (spec: event replacements). The fallback body is for
 * clients without edit support; `m.mentions` outside is empty so an edit
 * doesn't notify everyone mentioned all over again.
 */
export const buildEditContent = (
  original: MatrixEvent,
  body: string,
  picked: Mention[],
): RoomMessageEventContent => {
  // Keep emotes and notices what they were.
  const msgtype = original.getContent<{ msgtype?: string }>().msgtype ?? MsgType.Text;
  return {
    msgtype,
    body: `* ${body}`,
    "m.new_content": { ...buildTextContent(body, picked), msgtype },
    "m.mentions": {},
    "m.relates_to": { rel_type: "m.replace", event_id: original.getId() ?? "" },
  } as unknown as RoomMessageEventContent;
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

const permalink = (userId: string) => `https://matrix.to/#/${encodeURIComponent(userId)}`;

/**
 * A text message carrying intentional mentions (`m.mentions`, spec v1.7) and
 * pills in `formatted_body`, which Element renders as user chips. Mentions
 * whose name the user deleted from the draft are dropped.
 *
 * ponytail: matches picked names anywhere in the body, so a deleted mention
 * whose name still appears as plain text still notifies; track inserted ranges
 * in the composer if that ever matters.
 */
export const buildTextContent = (
  body: string,
  picked: Mention[],
  reply?: ReplyTarget,
  thread?: ThreadTarget,
): RoomMessageEventContent => {
  const mentions = picked.filter(
    (m, i) => body.includes(m.name) && picked.findIndex((p) => p.userId === m.userId) === i,
  );
  const userIds = [
    ...new Set([...mentions.map((m) => m.userId), ...(reply ? [reply.senderId] : [])]),
  ];
  const replyRelation = relationFor(reply, thread);
  if (mentions.length === 0) {
    return {
      msgtype: MsgType.Text,
      body,
      "m.mentions": userIds.length > 0 ? { user_ids: userIds } : {},
      ...replyRelation,
    } as RoomMessageEventContent;
  }
  // One pass over the plain text, longest names first, so a short name can't
  // match inside a longer one's pill and `$` in names isn't a replace pattern.
  const byName = new Map(mentions.map((m) => [m.name, m]));
  const names = [...byName.keys()].sort((x, y) => y.length - x.length);
  const pattern = new RegExp(
    names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "g",
  );
  let html = "";
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    const m = byName.get(match[0]);
    if (!m) continue;
    html += escapeHtml(body.slice(last, match.index));
    html += `<a href="${permalink(m.userId)}">${escapeHtml(m.name)}</a>`;
    last = match.index + match[0].length;
  }
  html += escapeHtml(body.slice(last));
  return {
    msgtype: MsgType.Text,
    body,
    format: "org.matrix.custom.html",
    formatted_body: html.replace(/\n/g, "<br>"),
    "m.mentions": { user_ids: userIds },
    ...replyRelation,
  } as RoomMessageEventContent;
};

/**
 * Whether a message mentions us. Clients that send `m.mentions` are trusted
 * exactly; older ones only had the body, so fall back to our name in it.
 */
export const mentionsUser = (
  content: { body?: unknown; "m.mentions"?: { user_ids?: unknown } },
  userId: string,
  displayName: string | undefined,
): boolean => {
  const declared = content["m.mentions"];
  if (declared) return Array.isArray(declared.user_ids) && declared.user_ids.includes(userId);
  const body = typeof content.body === "string" ? content.body.toLowerCase() : "";
  const localpart = userId.slice(1).split(":")[0] ?? "";
  return [displayName, localpart]
    .filter((n): n is string => !!n && n.length > 1)
    .some((n) => body.includes(n.toLowerCase()));
};
