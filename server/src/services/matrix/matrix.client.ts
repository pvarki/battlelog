import "varlock/auto-load";
import { ENV } from "varlock/env";
import { logger } from "../../lib/logger.ts";
import { productAuthzGet, rmInteropAdd, siblingProductHost } from "../../lib/mtls-client.ts";
import { setMatrixBotUserId } from "../ingest/ingest.state.ts";

/**
 * Client-Server API calls against the deployment's Synapse, as the ingest bot.
 *
 * The token belongs to a plain local user matrixrmapi created for us; it can
 * read and write the rooms that bot was joined to and nothing else. We get it
 * over the product interop API using our own client certificate, so no Matrix
 * secret is ever put in this container's environment.
 */

export class MatrixError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errcode?: string,
  ) {
    super(message);
    this.name = "MatrixError";
  }
}

/** The bit of a /sync response we read. Loose on purpose: the mapper validates. */
export type MatrixTimelineEvent = {
  type?: string;
  event_id?: string;
  sender?: string;
  origin_server_ts?: number;
  content?: Record<string, unknown>;
};

export type MatrixSyncResponse = {
  next_batch?: string;
  /** Where room keys arrive. Without processing these, nothing decrypts. */
  to_device?: { events?: unknown[] };
  device_lists?: { changed?: string[]; left?: string[] };
  device_one_time_keys_count?: Record<string, number>;
  device_unused_fallback_key_types?: string[];
  rooms?: {
    join?: Record<string, { timeline?: { events?: MatrixTimelineEvent[]; limited?: boolean } }>;
  };
};

export type MatrixRoomSummary = {
  roomId: string;
  name?: string;
  alias?: string;
  isSpace: boolean;
};

export class MatrixClient {
  private token: string | undefined;
  /** The bot's MXID, so a "you have to invite this account" message can name it. */
  private mxid: string | undefined;
  private device: string | undefined;

  constructor(private readonly baseUrl: string) {}

  /** The device this token belongs to, which is what room keys are shared with. */
  get deviceId(): string | undefined {
    return this.device;
  }

  /**
   * Fetch the ingest bot's credentials and find out which device they are for.
   *
   * matrixrmapi registers the bot, so the token it hands us is bound to a
   * device — that is the whole point, since room keys are shared with devices
   * and a device-less token can be in every room and decrypt nothing. The token
   * is stable across our restarts, so there is no session of our own to keep;
   * whoami is what tells us the device id to open the crypto store for.
   *
   * Asking RM for interop first is idempotent on matrixrmapi's side, so it
   * happens every boot rather than being tracked.
   */
  async setup(): Promise<void> {
    const product = ENV.MATRIX_PRODUCT_NAME;
    const host = siblingProductHost(product);
    if (!host) {
      throw new Error("cannot derive the Matrix product host from the kraftwerk manifest");
    }
    await rmInteropAdd(product);
    const authz = await productAuthzGet(host);
    if (authz.type !== "bearer-token" || !authz.token) {
      throw new Error(`${product} returned authz type "${authz.type}" with no token`);
    }
    this.token = authz.token;

    const me = await this.call<{ user_id?: string; device_id?: string }>(
      "/_matrix/client/v3/account/whoami",
      {},
    );
    this.mxid = me.user_id;
    this.device = me.device_id;
    setMatrixBotUserId(me.user_id);
    if (!me.device_id) {
      // Without a device nothing can share room keys with us, so every encrypted
      // room will stay unreadable however long we wait. Worth saying plainly.
      logger.error(
        { botUserId: me.user_id },
        "matrix ingest: this token has no device, so encrypted rooms cannot be read — matrixrmapi must register the bot rather than mint a token for it",
      );
    }
    logger.info(
      { product, host, botUserId: this.mxid, deviceId: this.device },
      "matrix ingest: got the ingest bot token",
    );
  }

  /** Drop the cached token so the next call fetches a fresh one. */
  forgetToken(): void {
    this.token = undefined;
    this.mxid = undefined;
    setMatrixBotUserId(undefined);
  }

  /** The bot's MXID once known, from whoami. */
  get userId(): string | undefined {
    return this.mxid;
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  private get authHeaders(): Record<string, string> {
    if (!this.token) throw new Error("MatrixClient.setup() has not been called");
    return { authorization: `Bearer ${this.token}` };
  }

  private async call<T>(path: string, params: Record<string, string>, signal?: AbortSignal) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const res = await fetch(url, { headers: this.authHeaders, signal });
    const text = await res.text();
    if (!res.ok) {
      let errcode: string | undefined;
      try {
        errcode = (JSON.parse(text) as { errcode?: string }).errcode;
      } catch {
        // A non-JSON error body is still an error, just a less useful one.
      }
      throw new MatrixError(
        `${path} returned ${res.status}: ${text.slice(0, 200)}`,
        res.status,
        errcode,
      );
    }
    return JSON.parse(text) as T;
  }

  /**
   * Long-poll for new events. `timeout` of 0 returns immediately, which is how
   * the first call gets a cursor without dragging in history.
   */
  async sync(opts: {
    since?: string;
    filter: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<MatrixSyncResponse> {
    const params: Record<string, string> = {
      filter: opts.filter,
      timeout: String(opts.timeoutMs),
    };
    if (opts.since) params.since = opts.since;
    return this.call<MatrixSyncResponse>("/_matrix/client/v3/sync", params, opts.signal);
  }

  private async post<T>(path: string, body: unknown = {}): Promise<T> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      headers: { ...this.authHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let errcode: string | undefined;
      try {
        errcode = (JSON.parse(text) as { errcode?: string }).errcode;
      } catch {
        // A non-JSON error body is still an error, just a less useful one.
      }
      throw new MatrixError(
        `${path} returned ${res.status}: ${text.slice(0, 200)}`,
        res.status,
        errcode,
      );
    }
    return JSON.parse(text) as T;
  }

  /**
   * Join a room, or accept a pending invite to it — in Matrix those are the same
   * call, which is what makes the bot able to sort itself out. Already being a
   * member is a success, so this is safe to retry.
   *
   * Fails with 403 for an invite-only room nobody has invited us to. That is not
   * an error to retry away: a person has to invite the bot.
   */
  async joinRoom(roomId: string): Promise<void> {
    await this.post(`/_matrix/client/v3/join/${encodeURIComponent(roomId)}`);
  }

  /**
   * Whether a room is end-to-end encrypted, read from its state rather than
   * inferred from traffic — so an unreadable room can be reported the moment we
   * join it instead of the first time somebody speaks.
   */
  async isEncrypted(roomId: string): Promise<boolean> {
    try {
      await this.call<unknown>(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption`,
        {},
      );
      return true;
    } catch (err) {
      // No such state event: the room is not encrypted.
      if (err instanceof MatrixError && err.status === 404) return false;
      throw err;
    }
  }

  /**
   * Create a room the ingester can actually read, and attach it to the Space.
   *
   * Deliberately without `m.room.encryption`: a client creating a private room
   * turns encryption on by default, and Matrix cannot undo that afterwards, so a
   * room meant to be ingested has to be made this way from the start. The topic
   * says as much, because a room whose contents are logged elsewhere should not
   * be a surprise to the people typing in it.
   *
   * The join rule mirrors the deployment's other rooms: anyone in the Space can
   * join, so nobody has to be invited one at a time.
   */
  async createIngestRoom(name: string, spaceId: string): Promise<string> {
    const created = await this.post<{ room_id: string }>("/_matrix/client/v3/createRoom", {
      name,
      preset: "private_chat",
      visibility: "private",
      topic: `Messages here are recorded into BattleLog's event feed. Not end-to-end encrypted.`,
      // The one thing that must not be here is an m.room.encryption event.
      initial_state: [
        {
          type: "m.room.join_rules",
          state_key: "",
          content: {
            join_rule: "restricted",
            allow: [{ type: "m.room_membership", room_id: spaceId }],
          },
        },
        {
          type: "m.room.history_visibility",
          state_key: "",
          content: { history_visibility: "joined" },
        },
      ],
      // Room version 8+ is required for restricted join rules.
      room_version: "10",
    });

    // Attach it to the Space so it shows up for everyone. matrixrmapi lowers the
    // m.space.child level to 0, so an ordinary member may do this.
    await this.putState(spaceId, "m.space.child", created.room_id, {
      via: [this.mxid?.split(":")[1] ?? ""],
      suggested: true,
    });
    return created.room_id;
  }

  private async putState(
    roomId: string,
    type: string,
    stateKey: string,
    content: unknown,
  ): Promise<void> {
    const res = await fetch(
      new URL(
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${type}/${encodeURIComponent(stateKey)}`,
        this.baseUrl,
      ),
      {
        method: "PUT",
        headers: { ...this.authHeaders, "content-type": "application/json" },
        body: JSON.stringify(content),
      },
    );
    if (!res.ok) {
      throw new MatrixError(
        `state ${type} on ${roomId} returned ${res.status}: ${(await res.text()).slice(0, 200)}`,
        res.status,
      );
    }
  }

  /**
   * Send one request on the crypto machine's behalf and return the raw body.
   *
   * The machine composes these itself and only needs them delivered; it treats
   * the response as opaque bytes, so no parsing happens here.
   */
  async cryptoSend(d: { path: string; body: string; method?: "PUT" }): Promise<string> {
    const res = await fetch(new URL(d.path, this.baseUrl), {
      method: d.method ?? "POST",
      headers: { ...this.authHeaders, "content-type": "application/json" },
      body: d.body,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new MatrixError(`${d.path} returned ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    return text;
  }

  /** MXIDs currently joined to a room, for device tracking. */
  async joinedMembers(roomId: string): Promise<string[]> {
    const body = await this.call<{ joined?: Record<string, unknown> }>(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`,
      {},
    );
    return Object.keys(body.joined ?? {});
  }

  async roomIdForAlias(alias: string): Promise<string | undefined> {
    try {
      const body = await this.call<{ room_id?: string }>(
        `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`,
        {},
      );
      return body.room_id;
    } catch (err) {
      if (err instanceof MatrixError && err.status === 404) return undefined;
      throw err;
    }
  }

  /**
   * Rooms in a space, so the settings page can offer a list instead of asking
   * someone to type a room ID.
   *
   * Whether a room is readable is not reported here: the hierarchy summary does
   * not carry encryption state, and guessing would be worse than the ingester
   * saying so per source once it has actually looked.
   */
  async spaceRooms(spaceId: string): Promise<MatrixRoomSummary[]> {
    const body = await this.call<{
      rooms?: {
        room_id: string;
        name?: string;
        canonical_alias?: string;
        room_type?: string;
      }[];
    }>(`/_matrix/client/v1/rooms/${encodeURIComponent(spaceId)}/hierarchy`, {
      limit: "100",
      max_depth: "1",
    });
    return (body.rooms ?? []).map((room) => ({
      roomId: room.room_id,
      name: room.name,
      alias: room.canonical_alias,
      isSpace: room.room_type === "m.space",
    }));
  }
}
