import { useEffect, useState } from "react";
import type { TakItem } from "../cot.ts";
import { takGetText } from "../rest.ts";

/** A TAK user the server has seen connect, from `GET /Marti/api/clientEndPoints`. */
export type KnownClient = {
  uid: string;
  callsign?: string;
  team?: string;
  role?: string;
  lastEventTime: number;
  connected: boolean;
};

const WINDOW_SECONDS = 24 * 60 * 60;
const REFRESH_MS = 30_000;

export const parseClients = (json: unknown): KnownClient[] => {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw) => {
    const c = raw as Record<string, unknown> | null;
    const lastEventTime = Date.parse(String(c?.lastEventTime));
    if (typeof c?.uid !== "string" || !c.uid || Number.isNaN(lastEventTime)) return [];
    const text = (value: unknown) => (typeof value === "string" && value) || undefined;
    return [
      {
        uid: c.uid,
        callsign: text(c.callsign),
        team: text(c.team),
        role: text(c.role),
        lastEventTime,
        connected: c.lastStatus === "Connected",
      },
    ];
  });
};

export const fetchKnownClients = async (signal?: AbortSignal): Promise<KnownClient[]> => {
  const query = new URLSearchParams({
    secAgo: String(WINDOW_SECONDS),
    // "true" would drop everyone disconnected (verified on TAK 5.8).
    showCurrentlyConnectedClients: "false",
    showMostRecentOnly: "true",
  });
  const text = await takGetText(`/Marti/api/clientEndPoints?${query}`, signal);
  return text ? parseClients(JSON.parse(text)) : [];
};

// At 0,0 like a report without a fix: the drawer shows no distance and can't centre on it.
const contactOf = (client: KnownClient): TakItem => {
  const time = client.lastEventTime;
  const stale = client.connected ? Number.POSITIVE_INFINITY : time;
  const type = "a-f-G-U-C";
  return {
    uid: client.uid,
    type,
    time,
    stale,
    geometry: { type: "Point", coordinates: [0, 0] },
    callsign: client.callsign,
    team: client.team,
    role: client.role,
    ...(client.connected ? {} : { offline: true }),
    event: {
      uid: client.uid,
      type,
      how: "h-g-i-g-o",
      time,
      start: time,
      stale,
      lat: 0,
      lon: 0,
      hae: 0,
      ce: 9_999_999,
      le: 9_999_999,
      detail: "",
    },
  };
};

/** The picture's users, plus those TAK knows of who haven't reported a position to it. */
export const mergeContacts = (
  picture: TakItem[],
  clients: KnownClient[],
  selfUid: string,
): TakItem[] => {
  const seen = new Set([selfUid, ...picture.map((c) => c.uid)]);
  const merged = [...picture];
  for (const client of clients) {
    if (seen.has(client.uid)) continue;
    seen.add(client.uid);
    merged.push(contactOf(client));
  }
  return merged;
};

/** TAK's known clients, refreshed while mounted; on failure the last answer, or none. */
export const useKnownClients = (): KnownClient[] => {
  const [clients, setClients] = useState<KnownClient[]>([]);
  useEffect(() => {
    const abort = new AbortController();
    const load = () =>
      fetchKnownClients(abort.signal).then(setClients, (err: unknown) => {
        if (!abort.signal.aborted) console.warn("TAK client list unavailable", err);
      });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(timer);
      abort.abort();
    };
  }, []);
  return clients;
};
