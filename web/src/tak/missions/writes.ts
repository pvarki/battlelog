import { useSyncExternalStore } from "react";
import { TakRequestError, takBaseUrl, takGetText, uploadFile } from "../rest.ts";
import { type Mission, missionPath } from "./missions.ts";
import { refreshMissions } from "./store.ts";

/**
 * Changes to TAK missions, as ATAK's Data Sync makes them. TAK answers 200 to
 * an item added by a client uid that isn't subscribed and stores nothing, so
 * every write needs a subscription and is confirmed by reading the mission back.
 */

export type TakWrite = {
  method: "PUT" | "POST" | "DELETE";
  path: string;
  body?: unknown;
};

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const createMissionRequest = (
  name: string,
  description: string,
  clientUid: string,
): TakWrite => ({
  method: "PUT",
  path: `${missionPath(name)}?${query({ creatorUid: clientUid, description, tool: "public" })}`,
});

export const subscriptionPath = (name: string, clientUid: string) =>
  `${missionPath(name)}/subscription?${query({ uid: clientUid })}`;

export const addContentsRequest = (
  name: string,
  contents: { uids: string[] } | { hashes: string[] },
  clientUid: string,
): TakWrite => ({
  method: "PUT",
  path: `${missionPath(name)}/contents?${query({ creatorUid: clientUid })}`,
  body: contents,
});

export const removeContentRequest = (
  name: string,
  content: { uid: string } | { hash: string },
  clientUid: string,
): TakWrite => ({
  method: "DELETE",
  path: `${missionPath(name)}/contents?${query({ ...content, creatorUid: clientUid })}`,
});

export const logEntryRequest = (
  name: string,
  content: string,
  clientUid: string,
  now = Date.now(),
): TakWrite => ({
  method: "POST",
  path: "/Marti/api/missions/logs/entries",
  body: { dtg: new Date(now).toISOString(), content, creatorUid: clientUid, missionNames: [name] },
});

export const deleteMissionRequest = (name: string, clientUid: string): TakWrite => ({
  method: "DELETE",
  path: `${missionPath(name)}?${query({ creatorUid: clientUid })}`,
});

/**
 * TAK lets any subscriber delete a mission, so BattleLog offers it only to its
 * creator, as ATAK does.
 */
export const canDelete = (mission: Mission, clientUid: string | undefined) =>
  !!clientUid && mission.creatorUid === clientUid;

/** The mission token from a subscribe or create response. */
export const parseToken = (json: unknown): string | undefined => {
  const data = (json as { data?: unknown })?.data;
  const token = (Array.isArray(data) ? data[0] : data)?.token;
  return typeof token === "string" && token ? token : undefined;
};

const send = async ({ method, path, body }: TakWrite, token?: string): Promise<string> => {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.MissionAuthorization = `Bearer ${token}`;
  const res = await fetch(`${takBaseUrl()}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new TakRequestError(path.split("?")[0] as string, res.status);
  return res.text();
};

/** Mission token per mission name; null when not subscribed, missing until asked. */
let subscriptions: ReadonlyMap<string, string | null> = new Map();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<string | null>>();

const setSubscription = (name: string, token: string | null) => {
  subscriptions = new Map(subscriptions).set(name, token);
  for (const listener of listeners) listener();
};

export const useSubscriptions = (): ReadonlyMap<string, string | null> =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => subscriptions,
  );

/** Asks TAK whether this client uid is subscribed; its answer holds the token. */
export const loadSubscription = (name: string, clientUid: string): Promise<string | null> => {
  const known = subscriptions.get(name);
  if (known !== undefined) return Promise.resolve(known);
  let pending = inFlight.get(name);
  if (!pending) {
    pending = takGetText(subscriptionPath(name, clientUid))
      .then((text) => {
        // A subscribe or unsubscribe while this was in flight knows better.
        const settled = subscriptions.get(name);
        if (settled !== undefined) return settled;
        const token = text ? (parseToken(JSON.parse(text)) ?? null) : null;
        setSubscription(name, token);
        return token;
      })
      .finally(() => inFlight.delete(name));
    inFlight.set(name, pending);
  }
  return pending;
};

export const subscribe = async (name: string, clientUid: string) => {
  const token = parseToken(
    JSON.parse(await send({ method: "PUT", path: subscriptionPath(name, clientUid) })),
  );
  if (!token) throw new Error("TAK subscribed without a mission token");
  setSubscription(name, token);
};

export const unsubscribe = async (name: string, clientUid: string) => {
  await send({ method: "DELETE", path: subscriptionPath(name, clientUid) });
  setSubscription(name, null);
};

export class NotSubscribedError extends Error {
  constructor(readonly mission: string) {
    super(`Subscribe to ${mission} first: TAK ignores changes from non-subscribers.`);
  }
}

const writeAsSubscriber = async (name: string, clientUid: string, write: TakWrite) => {
  const token = await loadSubscription(name, clientUid);
  if (!token) throw new NotSubscribedError(name);
  return send(write, token);
};

/** The mission as TAK now has it; throws when it no longer exists. */
const readBack = async (name: string): Promise<Mission> => {
  const mission = (await refreshMissions()).find((m) => m.name === name);
  if (!mission) throw new Error(`Mission ${name} is gone`);
  return mission;
};

const unconfirmed = (what: string) => new Error(`TAK didn't confirm ${what}`);

export const createMission = async (name: string, description: string, clientUid: string) => {
  // A create on an existing name updates that mission; TAK hides invite-only ones (403).
  const existing = await takGetText(missionPath(name)).catch((err: unknown) => {
    if (err instanceof TakRequestError && err.status === 403) return "restricted";
    throw err;
  });
  if (existing) throw new Error(`A mission named ${name} already exists`);
  const created = await send(createMissionRequest(name, description, clientUid));
  // TAK subscribes the creator as owner.
  setSubscription(name, parseToken(JSON.parse(created)) ?? null);
  await readBack(name);
};

export const addItem = async (name: string, uid: string, clientUid: string) => {
  await writeAsSubscriber(name, clientUid, addContentsRequest(name, { uids: [uid] }, clientUid));
  if (!(await readBack(name)).itemUids.includes(uid)) throw unconfirmed("the added item");
};

export const removeItem = async (name: string, uid: string, clientUid: string) => {
  await writeAsSubscriber(name, clientUid, removeContentRequest(name, { uid }, clientUid));
  if ((await readBack(name)).itemUids.includes(uid)) throw unconfirmed("the removal");
};

export const addFile = async (name: string, file: File, clientUid: string) => {
  if (!(await loadSubscription(name, clientUid))) throw new NotSubscribedError(name);
  const hash = await uploadFile(file, file.name, clientUid);
  await writeAsSubscriber(name, clientUid, addContentsRequest(name, { hashes: [hash] }, clientUid));
  if (!(await readBack(name)).files.some((f) => f.hash === hash)) throw unconfirmed("the file");
};

export const removeFile = async (name: string, hash: string, clientUid: string) => {
  await writeAsSubscriber(name, clientUid, removeContentRequest(name, { hash }, clientUid));
  if ((await readBack(name)).files.some((f) => f.hash === hash)) throw unconfirmed("the removal");
};

/** Adds a log entry; the caller reloads the log to show it. */
export const addLogEntry = async (name: string, content: string, clientUid: string) => {
  await writeAsSubscriber(name, clientUid, logEntryRequest(name, content, clientUid));
};

export const deleteMission = async (name: string, clientUid: string) => {
  await send(deleteMissionRequest(name, clientUid));
  if ((await refreshMissions()).some((m) => m.name === name)) throw unconfirmed("the deletion");
  setSubscription(name, null);
};
