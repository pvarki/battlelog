import { type MatrixClient, type MatrixEvent, RelationType, type Room } from "matrix-js-sdk";
import { eventPreview, mentionsUser } from "./mentions.ts";

export type NotifyLevel = "off" | "mentions" | "all";

/** Catch-up after a reconnect replays older messages; those aren't news. */
const MAX_AGE_MS = 5 * 60_000;

// Two widgets on the same room must not notify twice.
const notified = new Set<string>();

let audio: AudioContext | undefined;

const beep = () => {
  audio ??= new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.15, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.25);
};

/** Pure decision, so it can be tested without a client. */
export const shouldNotify = (
  level: NotifyLevel,
  ev: { sender: string; ts: number; content: Parameters<typeof mentionsUser>[0] },
  me: { userId: string; name: string | undefined },
  now: number,
) => {
  if (level === "off" || ev.sender === me.userId || now - ev.ts > MAX_AGE_MS) return false;
  return level === "all" || mentionsUser(ev.content, me.userId, me.name);
};

export const notifyIfNeeded = async (
  client: MatrixClient,
  room: Room,
  ev: MatrixEvent,
  level: NotifyLevel,
) => {
  const id = ev.getId();
  if (level === "off" || !id || id.startsWith("~") || notified.has(id)) return;
  await client.decryptEventIfNeeded(ev);
  // Edits re-send the whole message; thread replies are relations too but are news.
  if (ev.getType() !== "m.room.message" || ev.isRelation(RelationType.Replace)) return;
  const userId = client.getSafeUserId();
  const sender = ev.getSender() ?? "";
  const notify = shouldNotify(
    level,
    { sender, ts: ev.getTs(), content: ev.getContent() },
    { userId, name: room.getMember(userId)?.name },
    Date.now(),
  );
  if (!notify || notified.has(id)) return;
  notified.add(id);

  beep();
  if (document.visibilityState === "visible" || Notification.permission !== "granted") return;
  const notification = new Notification(
    `${room.getMember(sender)?.name ?? sender} in ${room.name}`,
    {
      body: eventPreview(ev),
      tag: id,
    },
  );
  notification.onclick = () => window.focus();
};
