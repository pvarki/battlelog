import {
  DeviceId,
  DeviceLists,
  OlmMachine,
  RequestType,
  RoomId,
  UserId,
} from "@matrix-org/matrix-sdk-crypto-nodejs";
import { logger } from "../../lib/logger.ts";

/**
 * End-to-end decryption for the ingester.
 *
 * The rooms worth reading are encrypted, and encryption in Matrix is between
 * *devices*: a sender's client wraps each room key for every device it is
 * willing to share with. So we hold a device, publish its keys, and process the
 * to-device traffic that carries room keys to us. That is what this wraps.
 *
 * The heavy lifting is the matrix-rust-sdk crypto machine. Our job is to feed it
 * every /sync response and to send the requests it asks us to send — it cannot
 * reach the network itself, by design, so the sync loop drives it.
 *
 * Two things follow from how megolm works and cannot be engineered away here:
 * messages sent *before* this device joined a room are undecryptable, and a
 * sender whose client refuses to share with unverified devices sends us nothing
 * we can read.
 */

/** What the machine needs sending, and where. Method is POST unless stated. */
type Dispatch = { path: string; body: string; method?: "PUT" };

const dispatchFor = (req: {
  type: RequestType;
  body?: string;
  eventType?: string;
  txnId?: string;
}): Dispatch | undefined => {
  switch (req.type) {
    case RequestType.KeysUpload:
      return { path: "/_matrix/client/v3/keys/upload", body: req.body ?? "{}" };
    case RequestType.KeysQuery:
      return { path: "/_matrix/client/v3/keys/query", body: req.body ?? "{}" };
    case RequestType.KeysClaim:
      return { path: "/_matrix/client/v3/keys/claim", body: req.body ?? "{}" };
    case RequestType.SignatureUpload:
      return { path: "/_matrix/client/v3/keys/signatures/upload", body: req.body ?? "{}" };
    case RequestType.ToDevice:
      return {
        method: "PUT",
        path: `/_matrix/client/v3/sendToDevice/${encodeURIComponent(
          req.eventType ?? "",
        )}/${encodeURIComponent(req.txnId ?? "")}`,
        body: req.body ?? "{}",
      };
    default:
      // RoomMessage and KeysBackup: we neither send messages nor back keys up.
      return undefined;
  }
};

export type CryptoTransport = (d: Dispatch) => Promise<string>;

export class MatrixCrypto {
  private constructor(private readonly machine: OlmMachine) {}

  /**
   * Open the crypto store for this device, creating it if new.
   *
   * `storePath` must be on a persistent volume: it holds the device's identity
   * and every room key shared with it. Losing it means everything encrypted
   * before becomes unreadable, permanently.
   */
  static async open(userId: string, deviceId: string, storePath: string): Promise<MatrixCrypto> {
    const machine = await OlmMachine.initialize(
      new UserId(userId),
      new DeviceId(deviceId),
      storePath,
    );
    logger.info({ userId, deviceId, storePath }, "matrix crypto: store open");
    return new MatrixCrypto(machine);
  }

  /**
   * Hand the machine what a /sync returned, then send whatever it asks for.
   *
   * Both halves matter: the to-device events are how room keys reach us, and the
   * outgoing requests are how our device keys reach everyone else. Skipping the
   * second means senders never see a device to share with.
   */
  async processSync(
    sync: {
      to_device?: { events?: unknown[] };
      device_lists?: { changed?: string[]; left?: string[] };
      device_one_time_keys_count?: Record<string, number>;
      device_unused_fallback_key_types?: string[];
    },
    send: CryptoTransport,
  ): Promise<void> {
    await this.machine.receiveSyncChanges(
      JSON.stringify(sync.to_device?.events ?? []),
      new DeviceLists(
        (sync.device_lists?.changed ?? []).map((u) => new UserId(u)),
        (sync.device_lists?.left ?? []).map((u) => new UserId(u)),
      ),
      sync.device_one_time_keys_count ?? {},
      sync.device_unused_fallback_key_types ?? [],
    );
    await this.pump(send);
  }

  /** Send everything the machine has queued, telling it the outcome of each. */
  private async pump(send: CryptoTransport): Promise<void> {
    for (const req of await this.machine.outgoingRequests()) {
      const dispatch = dispatchFor(req as never);
      if (!dispatch) continue;
      try {
        const response = await send(dispatch);
        await this.machine.markRequestAsSent(req.id, req.type, response);
      } catch (err) {
        // Leave it unmarked: the machine will offer it again next cycle rather
        // than assuming a key upload or a key share succeeded.
        logger.warn({ err, requestType: req.type }, "matrix crypto: request failed, will retry");
      }
    }
  }

  /**
   * Track these users' devices, so we learn about new ones and they learn about
   * us. Cheap and idempotent; called for the rooms we ingest.
   */
  async trackUsers(userIds: string[]): Promise<void> {
    if (!userIds.length) return;
    await this.machine.updateTrackedUsers(userIds.map((u) => new UserId(u)));
  }

  /**
   * Decrypt one m.room.encrypted event, or return null when we have no key for
   * it — which is ordinary for anything sent before this device joined.
   */
  async decrypt(event: unknown, roomId: string): Promise<Record<string, unknown> | null> {
    try {
      const decrypted = await this.machine.decryptRoomEvent(
        JSON.stringify(event),
        new RoomId(roomId),
      );
      return JSON.parse(decrypted.event) as Record<string, unknown>;
    } catch (err) {
      logger.debug({ err, roomId }, "matrix crypto: no key for this event");
      return null;
    }
  }
}
