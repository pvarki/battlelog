import { useSyncExternalStore } from "react";
import type { CotEvent } from "../cot.ts";
import { type ChatMessage, parseChat } from "./chat.ts";

/**
 * Chat seen in this tab, oldest first: what arrived and what we sent. Kept
 * in memory only; TAK Server doesn't archive chat, so a reload starts empty.
 */
let messages: ChatMessage[] = [];
// Anyone on TAK can send chat; keep what a long shift needs, not everything.
const MAX_MESSAGES = 1000;
const MAX_TEXT = 4000;
const listeners = new Set<() => void>();

/** Files a `b-t-f` event; false for anything that isn't chat. */
export const receiveChat = (event: CotEvent): boolean => {
  const message = parseChat(event);
  if (!message) return false;
  if (messages.some((m) => m.id === message.id)) return true;
  const kept = { ...message, text: message.text.slice(0, MAX_TEXT) };
  messages = [...messages, kept].sort((a, b) => a.time - b.time).slice(-MAX_MESSAGES);
  for (const listener of listeners) listener();
  return true;
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
