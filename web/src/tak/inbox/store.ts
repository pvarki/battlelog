import { notifications } from "@mantine/notifications";
import { useSyncExternalStore } from "react";
import type { CotEvent } from "../cot.ts";
import { type FileShare, parseFileShare } from "./fileshare.ts";

/**
 * Data packages announced to us while this tab was open, newest first.
 * Memory only: an announcement isn't archived, but the package stays on TAK
 * and is listed there.
 */
let inbox: FileShare[] = [];
const seen = new Set<string>();
const MAX_SHARES = 100;
const listeners = new Set<() => void>();

const set = (next: FileShare[]) => {
  inbox = next;
  for (const listener of listeners) listener();
};

/** Files a `b-f-t-r` announcement; false for anything that isn't one. */
export const receiveFileShare = (event: CotEvent): boolean => {
  const share = parseFileShare(event);
  if (!share) return false;
  if (seen.has(share.id)) return true;
  seen.add(share.id);
  set([share, ...inbox].slice(0, MAX_SHARES));
  notifications.show({
    title: `Data package from ${share.senderCallsign || "a TAK user"}`,
    message: `${share.name} — import it from Plans.`,
  });
  return true;
};

export const dismissShare = (id: string) => set(inbox.filter((s) => s.id !== id));

export const useInbox = (): FileShare[] =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => inbox,
  );
