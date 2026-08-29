import "varlock/auto-load";
import { readFileSync } from "node:fs";
import { Agent, request } from "node:https";
import { ENV } from "varlock/env";
import { trustBundle } from "../../lib/ca-bundle.ts";

/**
 * TAK Server's Marti REST API, over the same client certificate as the CoT
 * stream.
 *
 * This exists for one thing the stream cannot give us: Data Sync feeds, which
 * TAK calls missions. A mission's contents live in TAK's database and are
 * delivered to *subscribed* clients — TAK routes those pushes by the client uid
 * it learned from that client's own position reports, and BattleLog deliberately
 * sends nothing, so it has no uid on the wire and nothing is pushed to it.
 * Reading the mission's change log over HTTPS is the way in that does not
 * require putting a BattleLog marker on everyone's map.
 *
 * Its own agent rather than lib/mtls-client's: TAK's certificate is issued for
 * the deployment's public TAK FQDN, but inside docker we dial a service name, so
 * this connection needs a servername override that the RM calls must not have.
 */

const TIMEOUT_MS = 20_000;

let agent: Agent | undefined;

const takAgent = (): Agent => {
  if (!agent) {
    agent = new Agent({
      cert: readFileSync(ENV.TAK_CLIENT_CERT_PATH),
      key: readFileSync(ENV.TAK_CLIENT_KEY_PATH),
      ca: trustBundle(ENV.CA_PATH),
      keepAlive: true,
    });
  }
  return agent;
};

export class TakApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TakApiError";
  }
}

/** Everything Marti returns is wrapped in this envelope. */
type ApiResponse<T> = { version?: string; type?: string; data?: T; messages?: string[] };

const get = (path: string): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const host = ENV.TAK_STREAM_HOST;
    const req = request(
      `https://${host}:${ENV.TAK_API_PORT}${path}`,
      {
        method: "GET",
        agent: takAgent(),
        // Both the SNI name and the name the certificate is checked against:
        // node uses `servername` in preference to the host it dialled.
        servername: ENV.TAK_TLS_SERVERNAME || host,
        headers: { accept: "application/json" },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new TakApiError(`GET ${path} timed out`)));
    req.end();
  });

const martiGet = async <T>(path: string): Promise<T[]> => {
  const { status, text } = await get(path);
  if (status === 403 || status === 401) {
    // The single most likely failure in a real deployment, and the least
    // self-explanatory: TAK accepted the certificate but our TAK user is not
    // allowed to read this. Say what fixes it rather than just the number.
    throw new TakApiError(
      `TAK refused ${path} with ${status}. BattleLog's TAK user needs read access: ` +
        "check the feed's group and defaultRole in Mission Manager.",
      status,
    );
  }
  if (status !== 200) {
    throw new TakApiError(`TAK ${path} returned ${status}: ${text.slice(0, 200)}`, status);
  }
  let body: ApiResponse<T[]>;
  try {
    body = JSON.parse(text) as ApiResponse<T[]>;
  } catch {
    throw new TakApiError(`TAK ${path} returned unparseable JSON: ${text.slice(0, 200)}`);
  }
  return Array.isArray(body.data) ? body.data : [];
};

/** One Data Sync feed, as much of it as the settings page needs. */
export type TakMission = {
  name?: string;
  description?: string;
  /** GeoChat room bound to the feed. Its traffic arrives on the CoT stream, not here. */
  chatRoom?: string;
  tool?: string;
  createTime?: string;
  groups?: string[];
};

/** The map item a mission change is about. Marti calls this `details` on the wire. */
export type TakUidDetails = {
  type?: string;
  callsign?: string;
  title?: string;
  color?: string;
  iconsetPath?: string;
  location?: { lat?: number; lon?: number };
};

/** A file attached to a mission. */
export type TakMissionResource = {
  filename?: string;
  name?: string;
  hash?: string;
  size?: number;
  mimeType?: string;
  creatorUid?: string;
  submitter?: string;
};

/**
 * One entry in a mission's change log.
 *
 * Field names taken from TAK 5.8's com.bbn.marti.sync.model.MissionChange —
 * note `details`, which is the @JsonProperty name of the uidDetails field and
 * not what the Java field is called.
 */
export type TakMissionChange = {
  type?: string;
  missionName?: string;
  timestamp?: string;
  creatorUid?: string;
  contentUid?: string;
  contentHash?: string;
  details?: TakUidDetails;
  contentResource?: TakMissionResource;
};

/** Data Sync feeds this deployment's TAK user can see. */
export const listMissions = (): Promise<TakMission[]> =>
  martiGet<TakMission>("/Marti/api/missions");

/** What changed in one feed over the last `secago` seconds. */
export const missionChanges = (missionName: string, secago: number): Promise<TakMissionChange[]> =>
  martiGet<TakMissionChange>(
    `/Marti/api/missions/${encodeURIComponent(missionName)}/changes?secago=${Math.round(secago)}&squashed=false`,
  );
