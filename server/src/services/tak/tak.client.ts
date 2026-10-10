import "varlock/auto-load";
import { readFileSync } from "node:fs";
import https from "node:https";
import tls from "node:tls";
import { ENV } from "varlock/env";
import { logger } from "../../lib/logger.ts";
import { parseCot, splitEvents } from "./cot.ts";
import type { TakState } from "./tak.state.ts";

const RECONNECT_DELAY_MS = 5000;
const SWEEP_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BUFFER_CHARS = 1_000_000;
const MAX_ARCHIVE_CHARS = 100_000_000;

export type TakClientConfig = {
  host: string;
  streamPort: number;
  apiPort: number;
  backfillDays: number;
  tls: Pick<tls.ConnectionOptions, "cert" | "key" | "ca">;
};

export const takConfigFromEnv = (): TakClientConfig | undefined => {
  if (!ENV.TAK_HOST) {
    logger.error("TAK_ENABLED but TAK_HOST is unset; TAK map disabled");
    return undefined;
  }
  try {
    return {
      host: ENV.TAK_HOST,
      streamPort: ENV.TAK_STREAM_PORT,
      apiPort: ENV.TAK_API_PORT,
      backfillDays: ENV.TAK_BACKFILL_DAYS,
      tls: {
        cert: readFileSync(ENV.TAK_CERT_PATH),
        key: readFileSync(ENV.TAK_KEY_PATH),
        ca: readFileSync(ENV.TAK_CA_PATH),
      },
    };
  } catch (err) {
    logger.error({ err }, "TAK credentials unreadable; TAK map disabled");
    return undefined;
  }
};

// The stream presents an RM-signed cert, but Marti REST (8443) presents a
// public Let's Encrypt one, so trust both.
const tlsOptions = (cfg: TakClientConfig) => ({
  ...cfg.tls,
  ca: [...tls.rootCertificates, ...[cfg.tls.ca ?? []].flat()],
  servername: cfg.host,
  rejectUnauthorized: true,
  allowPartialTrustChain: true,
});

const applyAll = (state: TakState, xml: string) => {
  for (const event of splitEvents(xml).events) {
    const change = parseCot(event);
    if (change) state.apply(change);
  }
};

const getArchive = (cfg: TakClientConfig, start: Date, end: Date) =>
  new Promise<string>((resolve, reject) => {
    // Drawings and deletes are only returned with isFiltered=false.
    const query = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      isFiltered: "false",
    });
    const req = https.get(
      { host: cfg.host, port: cfg.apiPort, path: `/Marti/api/cot/sa?${query}`, ...tlsOptions(cfg) },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > MAX_ARCHIVE_CHARS) req.destroy(new Error("cot/sa response too large"));
        });
        res.on("end", () => {
          if (res.statusCode === 404) resolve("");
          else if (res.statusCode === 200) resolve(body);
          else reject(new Error(`cot/sa ${res.statusCode}: ${body.slice(0, 200)}`));
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(60_000, () => req.destroy(new Error("cot/sa timed out")));
  });

/** TAK caps archive queries at 24 h, so long-lived items need one query per day. */
const backfill = async (cfg: TakClientConfig, state: TakState, isCurrent: () => boolean) => {
  const now = Date.now();
  for (let day = cfg.backfillDays; day > 0 && isCurrent(); day--) {
    const start = new Date(now - day * DAY_MS);
    const end = new Date(now - (day - 1) * DAY_MS);
    try {
      const xml = await getArchive(cfg, start, end);
      if (isCurrent()) applyAll(state, xml);
    } catch (err) {
      logger.warn({ err, start }, "tak backfill window failed");
    }
  }
  logger.info({ items: state.snapshot().length }, "tak backfill done");
};

/** Follows TAK's live CoT stream into `state`. Read-only: never writes CoT. */
export const startTakClient = (state: TakState, cfg: TakClientConfig): (() => void) => {
  let stopped = false;
  let socket: tls.TLSSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const sweeper = setInterval(() => state.sweep(), SWEEP_INTERVAL_MS);

  const connect = () => {
    const current = ++generation;
    const isCurrent = () => !stopped && current === generation;
    let buffer = "";
    const s = tls.connect({ host: cfg.host, port: cfg.streamPort, ...tlsOptions(cfg) }, () => {
      logger.info({ host: cfg.host }, "tak stream connected");
      void backfill(cfg, state, isCurrent);
    });
    socket = s;
    s.setEncoding("utf8");
    s.setKeepAlive(true, 30_000);
    s.on("data", (chunk: string) => {
      const { events, rest } = splitEvents(buffer + chunk);
      buffer = rest;
      if (buffer.length > MAX_BUFFER_CHARS) {
        logger.warn("tak stream buffer overflow, dropping partial event");
        buffer = "";
      }
      for (const event of events) {
        const change = parseCot(event);
        if (change) state.apply(change);
      }
    });
    s.on("error", (err) => logger.error({ err }, "tak stream error"));
    s.on("close", () => {
      if (stopped) return;
      logger.warn("tak stream closed, reconnecting");
      retry = setTimeout(connect, RECONNECT_DELAY_MS);
    });
  };

  connect();

  return () => {
    stopped = true;
    clearInterval(sweeper);
    clearTimeout(retry);
    socket?.destroy();
  };
};
