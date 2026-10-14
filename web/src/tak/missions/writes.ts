import { useEffect, useSyncExternalStore } from "react";
import { TakRequestError, type TakWrite, takGetText, takSend, uploadFile } from "../rest.ts";
import {
  type InviteeType,
  isAccessDenied,
  MISSION_ROLES,
  type Mission,
  type MissionRole,
  missionPath,
} from "./missions.ts";
import { refreshMissions } from "./store.ts";

/**
 * Changes to TAK missions, as ATAK's Data Sync makes them. TAK answers 200 to
 * an item added by a client uid that isn't subscribed and stores nothing, so
 * every write needs a subscription and is confirmed by reading the mission back.
 */

const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

export type NewMission = {
  description?: string;
  /** TAK takes it only in the query; `takSend` keeps queries out of its errors. */
  password?: string;
  defaultRole?: MissionRole;
  inviteOnly?: boolean;
};

const definedOnly = (params: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>;

export const createMissionRequest = (
  name: string,
  { description = "", password, defaultRole, inviteOnly }: NewMission,
  clientUid: string,
): TakWrite => ({
  method: "PUT",
  path: `${missionPath(name)}?${query({
    creatorUid: clientUid,
    description,
    tool: "public",
    ...definedOnly({ password, defaultRole, inviteOnly: inviteOnly ? "true" : undefined }),
  })}`,
});

export const subscriptionPath = (name: string, clientUid: string, password?: string) =>
  `${missionPath(name)}/subscription?${query({ uid: clientUid, ...definedOnly({ password }) })}`;

export const setRoleRequest = (name: string, clientUid: string, role: MissionRole): TakWrite => ({
  method: "PUT",
  path: `${missionPath(name)}/role?${query({ clientUid, role })}`,
});

const invitePath = (name: string, type: InviteeType, invitee: string) =>
  `${missionPath(name)}/invite/${type}/${encodeURIComponent(invitee)}`;

export const inviteRequest = (
  name: string,
  type: InviteeType,
  invitee: string,
  role: MissionRole,
  clientUid: string,
): TakWrite => ({
  method: "PUT",
  path: `${invitePath(name, type, invitee)}?${query({ creatorUid: clientUid, role })}`,
});

export const uninviteRequest = (
  name: string,
  type: InviteeType,
  invitee: string,
  clientUid: string,
): TakWrite => ({
  method: "DELETE",
  path: `${invitePath(name, type, invitee)}?${query({ creatorUid: clientUid })}`,
});

export const setPasswordRequest = (
  name: string,
  password: string,
  clientUid: string,
): TakWrite => ({
  method: "PUT",
  path: `${missionPath(name)}/password?${query({ password, creatorUid: clientUid })}`,
});

export const removePasswordRequest = (name: string, clientUid: string): TakWrite => ({
  method: "DELETE",
  path: `${missionPath(name)}/password?${query({ creatorUid: clientUid })}`,
});

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
 * creator and owners, as ATAK does.
 */
export const canDelete = (
  mission: Mission,
  clientUid: string | undefined,
  role: MissionRole | undefined,
) => !!clientUid && (mission.creatorUid === clientUid || role === "MISSION_OWNER");

/** An unknown role may write: a TAK without roles treats every subscriber alike. */
export const canWriteAs = (role: MissionRole | undefined) => role !== "MISSION_READONLY_SUBSCRIBER";

/** This client's mission token and role. */
export type Subscription = { token: string; role?: MissionRole };

/** The subscription from a subscribe or create response. */
export const parseSubscription = (json: unknown): Subscription | undefined => {
  const data = (json as { data?: unknown })?.data;
  const entry = (Array.isArray(data) ? data[0] : data) as
    | { token?: unknown; role?: { type?: unknown } }
    | undefined;
  const token = entry?.token;
  if (typeof token !== "string" || !token) return undefined;
  const role = MISSION_ROLES.find((r) => r === entry?.role?.type);
  return role ? { token, role } : { token };
};

/** Why TAK refused a subscribe: it answers only 403. */
export const subscribeDeniedMessage = (mission: Mission | undefined, withPassword: boolean) =>
  withPassword
    ? "TAK refused the password."
    : mission?.passwordProtected
      ? "The mission needs a password."
      : "The mission is invite-only: ask an owner to invite you.";

/** Subscription per mission name; null when not subscribed, missing until asked. */
let subscriptions: ReadonlyMap<string, Subscription | null> = new Map();
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<Subscription | null>>();

const setSubscription = (name: string, subscription: Subscription | null) => {
  subscriptions = new Map(subscriptions).set(name, subscription);
  for (const listener of listeners) listener();
};

export const useSubscriptions = (): ReadonlyMap<string, Subscription | null> =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => subscriptions,
  );

/** Asks TAK whether this client uid is subscribed; its answer holds the token and role. */
export const loadSubscription = (name: string, clientUid: string): Promise<Subscription | null> => {
  const known = subscriptions.get(name);
  if (known !== undefined) return Promise.resolve(known);
  let pending = inFlight.get(name);
  if (!pending) {
    pending = takGetText(subscriptionPath(name, clientUid))
      .then((text) => {
        // A subscribe or unsubscribe while this was in flight knows better.
        const settled = subscriptions.get(name);
        if (settled !== undefined) return settled;
        const subscription = text ? (parseSubscription(JSON.parse(text)) ?? null) : null;
        setSubscription(name, subscription);
        return subscription;
      })
      .finally(() => inFlight.delete(name));
    inFlight.set(name, pending);
  }
  return pending;
};

export const subscribe = async (
  name: string,
  clientUid: string,
  password?: string,
  mission?: Mission,
) => {
  const response = await takSend({
    method: "PUT",
    path: subscriptionPath(name, clientUid, password),
  }).catch((err: unknown) => {
    if (!isAccessDenied(err)) throw err;
    throw new Error(subscribeDeniedMessage(mission, !!password));
  });
  const subscription = parseSubscription(JSON.parse(response));
  if (!subscription) throw new Error("TAK subscribed without a mission token");
  setSubscription(name, subscription);
};

export const ensureSubscribed = async (name: string, clientUid: string) => {
  if (!(await loadSubscription(name, clientUid))) await subscribe(name, clientUid);
};

/**
 * Subscribes this client to the missions shown on its map, as ATAK does when
 * it syncs one, so TAK streams their changes instead of BattleLog refetching
 * them. A mission it may not join stays on polling.
 */
export const useMissionSubscriptions = (names: string[], clientUid: string | undefined) => {
  const key = names.join("\n");
  useEffect(() => {
    if (!clientUid || !key) return;
    for (const name of key.split("\n")) {
      ensureSubscribed(name, clientUid).catch((err) =>
        console.warn(`Couldn't subscribe to TAK mission ${name}`, err),
      );
    }
  }, [key, clientUid]);
};

export const unsubscribe = async (name: string, clientUid: string) => {
  await takSend({ method: "DELETE", path: subscriptionPath(name, clientUid) });
  setSubscription(name, null);
};

export class NotSubscribedError extends Error {
  constructor(readonly mission: string) {
    super(`Subscribe to ${mission} first: TAK ignores changes from non-subscribers.`);
  }
}

const writeAsSubscriber = async (
  name: string,
  clientUid: string,
  write: TakWrite,
  denied = "your role doesn't allow changes",
) => {
  const subscription = await loadSubscription(name, clientUid);
  if (!subscription) throw new NotSubscribedError(name);
  return takSend(write, subscription.token).catch((err: unknown) => {
    if (!isAccessDenied(err)) throw err;
    throw new Error(`TAK refused: ${denied} in ${name}.`);
  });
};

const OWNERS_ONLY = "only owners can do that";

/** The mission as TAK now has it; throws when it no longer exists. */
const readBack = async (name: string): Promise<Mission> => {
  const mission = (await refreshMissions([name])).find((m) => m.name === name);
  if (!mission) throw new Error(`Mission ${name} is gone`);
  return mission;
};

const unconfirmed = (what: string) => new Error(`TAK didn't confirm ${what}`);

export const createMission = async (name: string, settings: NewMission, clientUid: string) => {
  // A create on an existing name updates that mission; TAK hides invite-only ones (403).
  const existing = await takGetText(missionPath(name)).catch((err: unknown) => {
    if (err instanceof TakRequestError && err.status === 403) return "restricted";
    throw err;
  });
  if (existing) throw new Error(`A mission named ${name} already exists`);
  const created = await takSend(createMissionRequest(name, settings, clientUid));
  // TAK subscribes the creator as owner.
  const subscription = parseSubscription(JSON.parse(created));
  setSubscription(name, subscription ? { ...subscription, role: "MISSION_OWNER" } : null);
  await readBack(name);
};

/**
 * Adds the items in one change; resolves to those TAK didn't take. TAK fails
 * a whole batch (500) over one uid it has no CoT for, so then each goes alone.
 */
export const addItems = async (name: string, uids: string[], clientUid: string) => {
  const add = (some: string[]) =>
    writeAsSubscriber(name, clientUid, addContentsRequest(name, { uids: some }, clientUid));
  try {
    await add(uids);
  } catch (err) {
    if (!(err instanceof TakRequestError && err.status === 500) || uids.length < 2) throw err;
    for (const uid of uids) await add([uid]).catch(() => undefined);
  }
  const stored = new Set((await readBack(name)).itemUids);
  return uids.filter((uid) => !stored.has(uid));
};

export const addItem = async (name: string, uid: string, clientUid: string) => {
  if ((await addItems(name, [uid], clientUid)).length) throw unconfirmed("the added item");
};

export const removeItem = async (name: string, uid: string, clientUid: string) => {
  await writeAsSubscriber(name, clientUid, removeContentRequest(name, { uid }, clientUid));
  if ((await readBack(name)).itemUids.includes(uid)) throw unconfirmed("the removal");
};

/**
 * Removes the items one request each, as TAK takes them; resolves to those
 * still in the mission. The read-back, not each request, says what landed.
 */
export const removeItems = async (name: string, uids: string[], clientUid: string) => {
  for (const uid of uids) {
    await writeAsSubscriber(name, clientUid, removeContentRequest(name, { uid }, clientUid)).catch(
      () => undefined,
    );
  }
  const stored = new Set((await readBack(name)).itemUids);
  return uids.filter((uid) => stored.has(uid));
};

export const addFile = async (name: string, file: File, clientUid: string) => {
  const subscription = await loadSubscription(name, clientUid);
  if (!subscription) throw new NotSubscribedError(name);
  if (!canWriteAs(subscription.role)) throw new Error(`You're a read-only subscriber of ${name}.`);
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
  await takSend(deleteMissionRequest(name, clientUid));
  if ((await refreshMissions()).some((m) => m.name === name)) throw unconfirmed("the deletion");
  setSubscription(name, null);
};

export const setRole = async (
  name: string,
  member: string,
  role: MissionRole,
  clientUid: string,
) => {
  await writeAsSubscriber(name, clientUid, setRoleRequest(name, member, role), OWNERS_ONLY);
};

export const invite = async (
  name: string,
  type: InviteeType,
  invitee: string,
  role: MissionRole,
  clientUid: string,
) => {
  const request = inviteRequest(name, type, invitee, role, clientUid);
  await writeAsSubscriber(name, clientUid, request, OWNERS_ONLY);
};

export const uninvite = async (
  name: string,
  type: InviteeType,
  invitee: string,
  clientUid: string,
) => {
  const request = uninviteRequest(name, type, invitee, clientUid);
  await writeAsSubscriber(name, clientUid, request, OWNERS_ONLY);
};

/** Sets or, without `password`, removes the mission's password. */
export const setPassword = async (
  name: string,
  password: string | undefined,
  clientUid: string,
) => {
  const request = password
    ? setPasswordRequest(name, password, clientUid)
    : removePasswordRequest(name, clientUid);
  await writeAsSubscriber(name, clientUid, request, OWNERS_ONLY);
  if ((await readBack(name)).passwordProtected !== !!password) throw unconfirmed("the password");
};
