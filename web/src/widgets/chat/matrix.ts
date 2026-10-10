import {
  ClientEvent,
  createClient,
  HttpApiEvent,
  type MatrixClient,
  RoomEvent,
  SyncState,
} from "matrix-js-sdk";
import { CryptoEvent } from "matrix-js-sdk/lib/crypto-api/index.js";
import { useEffect, useReducer, useSyncExternalStore } from "react";
import { cryptoCallbacks, forgetSecretStorageKeys, showVerification } from "./encryption.ts";

/**
 * One Matrix client per browser: the rust-crypto store in IndexedDB must never
 * be driven by two clients at once, so a Web Lock elects the tab that runs it
 * and every chat widget on that tab shares the same client.
 */

export type ChatStatus =
  | { kind: "signed-out" }
  | { kind: "starting" }
  | { kind: "other-tab" }
  | { kind: "ready"; client: MatrixClient }
  | { kind: "error"; message: string };

type Session = { baseUrl: string; userId: string; deviceId: string; accessToken: string };

const SESSION_KEY = "battlelog.matrix.session";
const LOCK_NAME = "battlelog.matrix.client";
const LOGIN_TOKEN_PARAM = "loginToken";

// ponytail: assumes PVARKI's naming (battlelog.<deployment> → synapse.<deployment>);
// replace with a server-provided URL if a deployment ever breaks the pattern.
export const deploymentForHost = (hostname: string): string =>
  hostname
    .replace(/^mtls\./, "")
    .split(".")
    .slice(1)
    .join(".");

/** The PVARKI deployment we belong to: from VITE_PVARKI_DEPLOYMENT in dev, else our own host. */
const deployment = (): string =>
  import.meta.env.VITE_PVARKI_DEPLOYMENT || deploymentForHost(window.location.hostname);

const homeserverUrl = (): string => `https://synapse.${deployment()}`;

let status: ChatStatus = { kind: "signed-out" };
const listeners = new Set<() => void>();
let startRequested = false;
let running: MatrixClient | undefined;
let waiting: AbortController | undefined;

const setStatus = (next: ChatStatus) => {
  status = next;
  for (const l of listeners) l();
};

const readSession = (): Session | undefined => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : undefined;
  } catch {
    return undefined;
  }
};

const takeLoginToken = (): string | undefined => {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(LOGIN_TOKEN_PARAM) ?? undefined;
  if (token) {
    url.searchParams.delete(LOGIN_TOKEN_PARAM);
    history.replaceState(history.state, "", url);
  }
  return token;
};

const completeSsoLogin = async (loginToken: string): Promise<Session> => {
  const baseUrl = homeserverUrl();
  const res = await createClient({ baseUrl }).loginRequest({
    type: "m.login.token",
    token: loginToken,
    initial_device_display_name: "BattleLog",
  });
  const session = {
    baseUrl,
    userId: res.user_id,
    deviceId: res.device_id,
    accessToken: res.access_token,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
};

const runClient = async (session: Session) => {
  // Emoji only: we can't show or scan QR codes.
  const client = createClient({ ...session, cryptoCallbacks, verificationMethods: ["m.sas.v1"] });
  await client.initRustCrypto();
  client.on(CryptoEvent.VerificationRequestReceived, (request) => {
    if (request.isSelfVerification) showVerification(request);
  });
  client.on(ClientEvent.Sync, (state) => {
    if (state === SyncState.Prepared) setStatus({ kind: "ready", client });
  });
  client.on(HttpApiEvent.SessionLoggedOut, () => {
    client.stopClient();
    localStorage.removeItem(SESSION_KEY);
    setStatus({ kind: "signed-out" });
  });
  running = client;
  await client.startClient({ initialSyncLimit: 30 });
};

/** Resolves true when a client is now running in this tab. */
const start = async (): Promise<boolean> => {
  setStatus({ kind: "starting" });
  try {
    const loginToken = takeLoginToken();
    const session = loginToken ? await completeSsoLogin(loginToken) : readSession();
    if (!session) {
      setStatus({ kind: "signed-out" });
      return false;
    }
    await navigator.storage?.persist?.();
    await runClient(session);
    return true;
  } catch (err) {
    setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    return false;
  }
};

/** Runs the client in this tab once it holds the lock; queues behind another tab otherwise. */
const ensureStarted = () => {
  if (startRequested) return;
  startRequested = true;
  navigator.locks
    .request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) return holdAndStart();
      waitForLock();
    })
    .catch(lostLock);
};

const waitForLock = () => {
  const controller = new AbortController();
  waiting = controller;
  setStatus({ kind: "other-tab" });
  navigator.locks.request(LOCK_NAME, { signal: controller.signal }, holdAndStart).catch(() => {
    if (!controller.signal.aborted) lostLock();
  });
};

/** Another tab stole the lock: stop touching the crypto store and queue to get it back. */
const lostLock = () => {
  showVerification(undefined);
  running?.stopClient();
  running = undefined;
  waitForLock();
};

// ponytail: the old tab stops its client a moment after the steal, so an
// in-flight sync there can still overlap our start; add a BroadcastChannel
// handshake (old tab stops, then releases) if that ever shows up as UTDs.
export const takeOverChat = () => {
  waiting?.abort();
  navigator.locks.request(LOCK_NAME, { steal: true }, holdAndStart).catch(lostLock);
};

// The lock is released when this settles. A running client holds it for the
// tab's lifetime; a signed-out tab lets go so it can't strand another tab's
// SSO callback waiting behind it.
const holdAndStart = async () => {
  if (await start()) await new Promise<never>(() => {});
};

export const signIn = () => {
  const redirectUrl = window.location.href;
  window.location.href = createClient({ baseUrl: homeserverUrl() }).getSsoLoginUrl(redirectUrl);
};

export const signOut = async () => {
  if (status.kind === "ready") {
    const { client } = status;
    await client.logout(true).catch(() => {});
    await client.clearStores();
  }
  running = undefined;
  forgetSecretStorageKeys();
  localStorage.removeItem(SESSION_KEY);
  setStatus({ kind: "signed-out" });
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  ensureStarted();
  return () => listeners.delete(listener);
};

export const useChatStatus = (): ChatStatus => useSyncExternalStore(subscribe, () => status);

/** Re-renders the caller when rooms appear, disappear, or our membership changes. */
export const useRoomListChanges = (client: MatrixClient) => {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    client.on(ClientEvent.Room, rerender);
    client.on(ClientEvent.DeleteRoom, rerender);
    client.on(RoomEvent.MyMembership, rerender);
    return () => {
      client.off(ClientEvent.Room, rerender);
      client.off(ClientEvent.DeleteRoom, rerender);
      client.off(RoomEvent.MyMembership, rerender);
    };
  }, [client]);
};
