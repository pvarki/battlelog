import type { MatrixClient } from "matrix-js-sdk";
import {
  type CryptoCallbacks,
  CryptoEvent,
  decodeRecoveryKey,
  type GeneratedSecretStorageKey,
  type VerificationRequest,
} from "matrix-js-sdk/lib/crypto-api/index.js";
import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Device trust for the chat client: first-device setup (cross-signing + recovery
 * key + key backup), recovery-key unlock, and emoji verification with another
 * session. Secret-storage keys live in memory only, for this page load.
 */

const secretStorageKeys = new Map<string, Uint8Array<ArrayBuffer>>();

export const cryptoCallbacks: CryptoCallbacks = {
  getSecretStorageKey: async ({ keys }) => {
    const keyId = Object.keys(keys).find((id) => secretStorageKeys.has(id));
    const key = keyId && secretStorageKeys.get(keyId);
    return keyId && key ? [keyId, key] : null;
  },
  cacheSecretStorageKey: (keyId, _info, key) => void secretStorageKeys.set(keyId, key),
};

export const forgetSecretStorageKeys = () => secretStorageKeys.clear();

/** `new`: no recovery set up yet — first device, or an earlier setup that failed midway. */
export type DeviceTrust = "checking" | "verified" | "unverified" | "new";

const deviceTrust = async (client: MatrixClient): Promise<DeviceTrust> => {
  const crypto = client.getCrypto();
  const userId = client.getSafeUserId();
  if (!crypto) return "unverified";
  const device = await crypto.getDeviceVerificationStatus(userId, client.getDeviceId() ?? "");
  if (device?.crossSigningVerified) {
    return (await crypto.isSecretStorageReady()) ? "verified" : "new";
  }
  return (await crypto.userHasCrossSigningKeys(userId, true)) ? "unverified" : "new";
};

export const useDeviceTrust = (client: MatrixClient): DeviceTrust => {
  const [trust, setTrust] = useState<DeviceTrust>("checking");
  useEffect(() => {
    let live = true;
    const refresh = () =>
      void deviceTrust(client).then(
        (t) => live && setTrust(t),
        () => {},
      );
    refresh();
    client.on(CryptoEvent.KeysChanged, refresh);
    client.on(CryptoEvent.UserTrustStatusChanged, refresh);
    client.on(CryptoEvent.DevicesUpdated, refresh);
    return () => {
      live = false;
      client.off(CryptoEvent.KeysChanged, refresh);
      client.off(CryptoEvent.UserTrustStatusChanged, refresh);
      client.off(CryptoEvent.DevicesUpdated, refresh);
    };
  }, [client]);
  return trust;
};

export const createRecoveryKey = async (client: MatrixClient) => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption isn't available");
  return crypto.createRecoveryKeyFromPassphrase();
};

/**
 * First device: creates cross-signing keys, stores them in secret storage under
 * the recovery key, and starts a key backup. Synapse lets the very first
 * cross-signing upload through without re-authentication (MSC3967).
 */
export const setUpEncryption = async (client: MatrixClient, key: GeneratedSecretStorageKey) => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption isn't available");
  // A failed earlier attempt can leave local keys that bootstrap would never upload.
  const published = await crypto.userHasCrossSigningKeys(client.getSafeUserId(), true);
  await crypto.bootstrapCrossSigning({
    setupNewCrossSigning: !published,
    authUploadDeviceSigningKeys: async (makeRequest) => void (await makeRequest(null)),
  });
  await crypto.bootstrapSecretStorage({
    createSecretStorageKey: async () => key,
    setupNewKeyBackup: true,
  });
};

/** Unlocks secret storage with the recovery key: signs this device and enables the key backup. */
export const unlockWithRecoveryKey = async (client: MatrixClient, recoveryKey: string) => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption isn't available");
  const stored = await client.secretStorage.getKey();
  if (!stored) throw new Error("This account has no recovery key set up.");
  const [keyId, info] = stored;
  let key: Uint8Array<ArrayBuffer>;
  try {
    key = decodeRecoveryKey(recoveryKey.trim());
  } catch {
    throw new Error("That doesn't look like a recovery key.");
  }
  if (!(await client.secretStorage.checkKey(key, info))) {
    throw new Error("Wrong recovery key.");
  }
  secretStorageKeys.set(keyId, key);
  // Imports the cross-signing keys from secret storage and signs this device.
  await crypto.bootstrapCrossSigning({});
  await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
  await crypto.checkKeyBackupAndEnable();
};

// One verification at a time, shown by whichever chat widget hosts the dialog.
let activeRequest: VerificationRequest | undefined;
const requestListeners = new Set<() => void>();

export const showVerification = (request: VerificationRequest | undefined) => {
  if (activeRequest?.pending && activeRequest !== request) {
    activeRequest.cancel().catch(() => {});
  }
  activeRequest = request;
  for (const l of requestListeners) l();
};

export const verifyWithOtherSession = async (client: MatrixClient) => {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption isn't available");
  showVerification(await crypto.requestOwnUserVerification());
};

const subscribeRequest = (listener: () => void) => {
  requestListeners.add(listener);
  return () => requestListeners.delete(listener);
};

export const useActiveVerification = () =>
  useSyncExternalStore(subscribeRequest, () => activeRequest);

// Every chat widget renders the dialog host; only the first mounted one shows it.
const hosts: object[] = [];

export const useIsVerificationHost = () => {
  const [me] = useState(() => ({}));
  const [, setVersion] = useState(0);
  useEffect(() => {
    hosts.push(me);
    const rerender = () => setVersion((v) => v + 1);
    requestListeners.add(rerender);
    rerender();
    return () => {
      hosts.splice(hosts.indexOf(me), 1);
      requestListeners.delete(rerender);
      for (const l of requestListeners) l();
    };
  }, [me]);
  return hosts[0] === me;
};
