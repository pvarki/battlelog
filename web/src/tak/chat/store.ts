import { useSyncExternalStore } from "react";
import type { CotEvent } from "../cot.ts";
import { loadSavedChat, saveChatMessage } from "../picture-cache.ts";
import { addTakReceiver } from "../session.ts";
import { ALL_CHAT_ROOMS, type ChatKind, type ChatMessage, parseChat } from "./chat.ts";

/**
 * Chat seen in this tab, oldest first: what arrived and what we sent. TAK
 * Server doesn't archive chat, so it's also kept in this browser
 * (`picture-cache.ts`) for a reload to come back to.
 */
let messages: ChatMessage[] = [];
// Anyone on TAK can send chat; keep what a long shift needs, not everything.
const MAX_MESSAGES = 1000;
const MAX_TEXT = 4000;
const listeners = new Set<() => void>();

const add = (added: ChatMessage[]) => {
  const known = new Set(messages.map((m) => m.id));
  const fresh = added.filter((m) => !known.has(m.id));
  if (fresh.length === 0) return;
  messages = [...messages, ...fresh].sort((a, b) => a.time - b.time).slice(-MAX_MESSAGES);
  for (const listener of listeners) listener();
};

/** Files a `b-t-f` event; false for anything that isn't chat. */
export const receiveChat = (event: CotEvent): boolean => {
  const message = parseChat(event);
  if (!message) return false;
  if (messages.some((m) => m.id === message.id)) return true;
  const kept = { ...message, text: message.text.slice(0, MAX_TEXT) };
  add([kept]);
  void saveChatMessage(kept).catch((err) => console.warn("Saving a chat message failed", err));
  return true;
};

/** Puts back the chat kept in this browser, alongside anything that arrived meanwhile. */
export const restoreChat = async () => {
  const saved = await loadSavedChat().catch(() => []);
  // Saved before chat had team and group rooms: everything was All Chat Rooms or direct.
  const kindOf = (m: ChatMessage): ChatKind => (m.roomId === ALL_CHAT_ROOMS ? "all" : "direct");
  add(saved.map((m) => ({ ...m, kind: m.kind ?? kindOf(m) })));
};

export const useChatMessages = (): ChatMessage[] =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => messages,
  );

addTakReceiver({ any: receiveChat, restore: () => void restoreChat() });
