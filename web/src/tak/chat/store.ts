import { useSyncExternalStore } from "react";
import type { CotEvent } from "../cot.ts";
import { type ChatMessage, parseChat } from "./chat.ts";

/**
 * Chat seen in this tab, oldest first: what arrived and what we sent. Kept
 * in memory only; TAK Server doesn't archive chat, so a reload starts empty.
 */
let messages: ChatMessage[] = [];
const listeners = new Set<() => void>();

/** Files a `b-t-f` event; false for anything that isn't chat. */
export const receiveChat = (event: CotEvent): boolean => {
  const message = parseChat(event);
  if (!message) return false;
  if (messages.some((m) => m.id === message.id)) return true;
  messages = [...messages, message].sort((a, b) => a.time - b.time);
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
