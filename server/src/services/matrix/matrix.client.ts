import "varlock/auto-load";
import { ENV } from "varlock/env";
import { logger } from "../../lib/logger.ts";
import { productAuthzGet, rmInteropAdd, siblingProductHost } from "../../lib/mtls-client.ts";

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

  constructor(private readonly baseUrl: string) {}

  /**
   * Obtain the ingest bot's access token. Asks RM for interop first, which is
   * idempotent on matrixrmapi's side and is what authorises the fetch that
   * follows, so it is done on every boot rather than tracked.
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
    logger.info({ product, host }, "matrix ingest: got the ingest bot token");
  }

  /** Drop the cached token so the next call fetches a fresh one. */
  forgetToken(): void {
    this.token = undefined;
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
