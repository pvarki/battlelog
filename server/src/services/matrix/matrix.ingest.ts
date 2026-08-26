import "varlock/auto-load";
import { ENV } from "varlock/env";
import { getManifestProductDns } from "../../lib/kraftwerk.ts";
import { logger } from "../../lib/logger.ts";
import { createEvent } from "../events/events.service.ts";
import {
  enabledIngestSources,
  getIngestCursor,
  setIngestCursor,
} from "../ingest/ingest.service.ts";
import { countEvent, setStatus, transportKey } from "../ingest/ingest.state.ts";
import type { MatrixSourceConfig } from "../ingest/ingest.types.ts";
import { MatrixClient, MatrixError, type MatrixTimelineEvent } from "./matrix.client.ts";
import { MatrixCrypto } from "./matrix.crypto.ts";
import { matrixEventToCreateInput } from "./matrix.map.ts";

/**
 * Turns messages in selected Matrix rooms into feed events.
 *
 * /sync long-poll rather than paging /messages: one cursor to keep, realtime
 * with no interval to tune, and no ambiguity about where to start on a first
 * run. The cursor is persisted so a restart resumes rather than replaying.
 *
 * The standard rooms in the deployment's Space are end-to-end encrypted, and no
 * amount of room membership changes that — megolm keys go client to device, not
 * through the server. Those rooms arrive as m.room.encrypted and are skipped
 * with one warning and a visible status per source, never silently. Only a room
 * created without encryption yields plaintext until this grows a crypto client.
 *
 * Off unless MATRIX_HOMESERVER_URL is set.
 */

const CURSOR_KEY = "matrix";
const MATRIX = transportKey("matrix");
const SYNC_TIMEOUT_MS = 30_000;
const TIMELINE_LIMIT = 100;
const RETRY_DELAY_MS = 5_000;

/** Our homeserver's domain, which is the deployment domain minus our own label. */
const serverDomain = (): string => {
  const dns = getManifestProductDns() ?? "";
  return dns.split(".").slice(1).join(".");
};

/**
 * Server-side filter. Bandwidth only — the loop re-checks the room and the type,
 * so a server that ignored this would still behave correctly. m.room.encrypted is
 * requested deliberately: it is how we find out a selected room is unreadable.
 */
const syncFilter = (roomIds: string[]): string =>
  JSON.stringify({
    presence: { not_types: ["*"] },
    account_data: { not_types: ["*"] },
    room: {
      rooms: roomIds,
      account_data: { not_types: ["*"] },
      ephemeral: { not_types: ["*"] },
      // Membership is needed to track whose devices to expect keys from.
      state: { types: ["m.room.member"] },
      timeline: { types: ["m.room.message", "m.room.encrypted"], limit: TIMELINE_LIMIT },
    },
  });

export const startMatrixIngest = (): (() => Promise<void>) => {
  const baseUrl = ENV.MATRIX_HOMESERVER_URL;
  if (!baseUrl) {
    logger.info("matrix ingest disabled (MATRIX_HOMESERVER_URL unset)");
    setStatus(MATRIX, "disabled");
    return async () => {};
  }

  const client = new MatrixClient(baseUrl);
  const abort = new AbortController();
  let stopped = false;
  /** Rooms we have already complained about, so one warning each, not one per poll. */
  const warnedEncrypted = new Set<string>();
  /** Rooms we have confirmed membership of, so the join is attempted once. */
  const joined = new Set<string>();
  /** One "cannot join" warning per room, cleared when we get in. */
  const warnedNotJoined = new Set<string>();
  /** Rooms whose members we have handed to the crypto machine. */
  const tracked = new Set<string>();
  let crypto: MatrixCrypto | undefined;

  const pause = (ms: number) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  /**
   * Make sure we are in a room we have been told to ingest, and report what we
   * find. Called for every configured room until it is joined.
   *
   * Joining is on us rather than on matrixrmapi: it only sweeps rooms at its own
   * startup, so a room created afterwards would never get the bot, and an invite
   * would sit unaccepted forever. A room the space makes joinable we simply
   * join; an invite-only one needs a person, and says so.
   */
  const ensureJoined = async (roomId: string, sourceId: string): Promise<boolean> => {
    if (joined.has(roomId)) return true;
    try {
      await client.joinRoom(roomId);
      joined.add(roomId);
    } catch (err) {
      const forbidden = err instanceof MatrixError && err.status === 403;
      setStatus(sourceId, "not-joined", forbidden ? "Invite the bot to this room" : String(err));
      if (!warnedNotJoined.has(roomId)) {
        warnedNotJoined.add(roomId);
        logger.warn(
          { err, roomId, botUserId: client.userId },
          forbidden
            ? "matrix ingest: cannot join this room by itself, a member has to invite the bot"
            : "matrix ingest: could not join room",
        );
      }
      return false;
    }
    warnedNotJoined.delete(roomId);
    logger.info({ roomId }, "matrix ingest: joined room");

    setStatus(sourceId, "connected");
    return true;
  };

  /**
   * Tell the crypto machine who is in a room, so it tracks their devices and
   * they learn about ours. Done once per room: membership changes arrive through
   * sync afterwards.
   */
  const trackRoom = async (roomId: string): Promise<void> => {
    if (!crypto || tracked.has(roomId)) return;
    try {
      await crypto.trackUsers(await client.joinedMembers(roomId));
      tracked.add(roomId);
    } catch (err) {
      logger.warn({ err, roomId }, "matrix ingest: could not read room membership");
    }
  };

  const handleRoom = async (
    roomId: string,
    sourceId: string,
    roomName: string | undefined,
    timeline: { events?: MatrixTimelineEvent[]; limited?: boolean },
    domain: string,
  ): Promise<void> => {
    if (timeline.limited) {
      logger.warn(
        { roomId, limit: TIMELINE_LIMIT },
        "matrix ingest: timeline truncated, older messages in this batch were dropped",
      );
    }
    for (const raw of timeline.events ?? []) {
      let ev = raw;
      if (ev.type === "m.room.encrypted") {
        const decrypted = crypto ? await crypto.decrypt(ev, roomId) : null;
        if (!decrypted) {
          // Ordinary for anything sent before this device joined, and for a
          // sender whose client will not share with an unverified device.
          setStatus(sourceId, "encrypted", "Waiting for room keys from a sender");
          if (!warnedEncrypted.has(roomId)) {
            warnedEncrypted.add(roomId);
            logger.warn(
              { roomId, roomName },
              "matrix ingest: no room key for an encrypted event yet — expected for messages sent before this device joined",
            );
          }
          continue;
        }
        // The envelope carries who and when; the plaintext carries what.
        ev = {
          ...(decrypted as { type?: string; content?: Record<string, unknown> }),
          event_id: raw.event_id,
          sender: raw.sender,
          origin_server_ts: raw.origin_server_ts,
        };
        setStatus(sourceId, "connected");
      }
      const input = matrixEventToCreateInput(ev, {
        roomId,
        roomName,
        serverDomain: domain,
        ingestSourceId: sourceId,
      });
      if (!input) continue;
      await createEvent(input);
      countEvent(sourceId);
      countEvent(MATRIX);
    }
  };

  /**
   * One poll.
   *
   * `polled` says whether a /sync actually happened, and the loop needs it: a
   * long-poll is its own delay, but the no-rooms path returns at once, and
   * looping straight back on that spins the process at 100% CPU.
   */
  type PollResult = { polled: false } | { polled: true; cursor: string };

  const pollOnce = async (since: string | undefined): Promise<PollResult> => {
    const sources = await enabledIngestSources("matrix");
    const byRoom = new Map<string, { sourceId: string; name?: string }>();
    for (const source of sources) {
      const config = source.config as MatrixSourceConfig;
      if (config.roomId) {
        byRoom.set(config.roomId, { sourceId: source.id, name: config.roomName });
      }
    }
    if (!byRoom.size) {
      // Nothing selected. Stay connected but idle: syncing with an empty room
      // filter would just burn a long-poll slot every 30s for nothing.
      setStatus(MATRIX, "connected");
      return { polled: false };
    }

    // Get into anything we are not in yet. A room we cannot join is left out of
    // the filter — /sync would return nothing for it anyway, and its source
    // already says why.
    const syncable: string[] = [];
    for (const [roomId, target] of byRoom) {
      if (await ensureJoined(roomId, target.sourceId)) syncable.push(roomId);
    }
    if (!syncable.length) {
      setStatus(MATRIX, "not-joined", "Not a member of any selected room");
      return { polled: false };
    }

    const body = await client.sync({
      since,
      filter: syncFilter(syncable),
      // First call returns at once: we want its cursor, not the history that
      // would otherwise arrive with it.
      timeoutMs: since ? SYNC_TIMEOUT_MS : 0,
      signal: abort.signal,
    });
    const next = body.next_batch;
    if (!next) throw new Error("matrix sync response carried no next_batch");
    setStatus(MATRIX, "connected");

    // Before reading the timeline: this is where room keys arrive, and where our
    // own device keys get published so senders have something to share with.
    if (crypto) {
      await crypto.processSync(body, (d) => client.cryptoSend(d));
      for (const roomId of syncable) await trackRoom(roomId);
    }

    if (!since) {
      logger.info({ rooms: syncable.length }, "matrix ingest started, reading from now on");
      return { polled: true, cursor: next };
    }

    const domain = serverDomain();
    for (const [roomId, joined] of Object.entries(body.rooms?.join ?? {})) {
      const target = byRoom.get(roomId);
      if (!target || !joined.timeline) continue;
      setStatus(target.sourceId, "connected");
      await handleRoom(roomId, target.sourceId, target.name, joined.timeline, domain);
    }
    return { polled: true, cursor: next };
  };

  const run = async (): Promise<void> => {
    let since = await getIngestCursor(CURSOR_KEY).catch(() => undefined);
    while (!stopped) {
      setStatus(MATRIX, "connecting");
      try {
        if (!client.hasToken) await client.setup();
        if (!crypto && client.userId && client.deviceId) {
          crypto = await MatrixCrypto.open(client.userId, client.deviceId, ENV.MATRIX_CRYPTO_STORE);
        }
        const result = await pollOnce(since);
        if (result.polled) {
          if (result.cursor !== since) {
            since = result.cursor;
            await setIngestCursor(CURSOR_KEY, result.cursor);
          }
          // The long-poll was the wait, so go straight back round.
          continue;
        }
        // No /sync happened, so nothing has waited yet — fall through to the
        // delay below rather than spinning.
      } catch (err) {
        if (stopped) return;
        const message = err instanceof Error ? err.message : String(err);
        // Repeats of the same failure drop to debug: this loop runs forever, and
        // a dependency that is simply absent must not fill the log with traces.
        const fresh = setStatus(MATRIX, "error", message);
        if (err instanceof MatrixError && err.errcode === "M_UNKNOWN_TOKEN") {
          // matrixrmapi rewrites the token on its own startup, so re-fetching
          // is the whole recovery. Only after that fails is this an outage.
          logger.warn("matrix ingest: token rejected, fetching a new one");
          client.forgetToken();
        } else if (fresh) {
          logger.error({ err }, "matrix ingest: poll failed, retrying");
        } else {
          logger.debug({ err }, "matrix ingest: poll failed, retrying (unchanged)");
        }
      }
      if (!stopped) await pause(RETRY_DELAY_MS);
    }
  };

  void run();

  return async () => {
    stopped = true;
    setStatus(MATRIX, "disabled");
    abort.abort();
  };
};
