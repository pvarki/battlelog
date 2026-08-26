import "varlock/auto-load";
import { readFileSync } from "node:fs";
import { connect, type TLSSocket } from "node:tls";
import { ENV } from "varlock/env";
import { loadCaBundle } from "../../lib/ca-bundle.ts";
import { logger } from "../../lib/logger.ts";
import { rmInteropAdd } from "../../lib/mtls-client.ts";
import { createEvent } from "../events/events.service.ts";
import { enabledIngestSources } from "../ingest/ingest.service.ts";
import { countEvent, setStatus, transportKey } from "../ingest/ingest.state.ts";
import { type CotEvent, extractCotEvents, parseCotEvent } from "./tak.cot.ts";
import { matchTakSource } from "./tak.filter.ts";
import { cotToCreateInput } from "./tak.map.ts";

/**
 * Reads TAK Server's CoT stream and turns matching messages into feed events.
 *
 * We connect as an ordinary TAK client over mTLS with the RM-issued certificate
 * kw_product_init writes on first run. TAK trusts the RM CA for TLS, but it also
 * requires the CN to be a known TAK user — takrmapi's /api/v1/interop/add is
 * what enrols us, and until it has, TAK closes the connection right after the
 * handshake. That shows up here as a connect/disconnect loop, which is why the
 * status carries the last error.
 *
 * Inserted events reach browsers through the existing events_notify trigger and
 * the events listener, so nothing here touches the emitter: doing so would
 * deliver twice and skip the commit barrier.
 *
 * Off unless TAK_STREAM_HOST is set.
 */

const RECONNECT_DELAY_MS = 5_000;
const TAK = transportKey("tak");

/** Log an unreadable message once per connection rather than per event. */
const parseFailureLimit = 5;

const ingest = async (cot: CotEvent): Promise<void> => {
  // Re-read per event (the service caches for a few seconds), so an admin
  // toggling a source in the UI takes effect without a restart.
  const sources = await enabledIngestSources("tak");
  const source = matchTakSource(cot, sources);
  if (!source) return;
  await createEvent(cotToCreateInput(cot, source.id));
  countEvent(source.id);
  countEvent(TAK);
};

export const startTakIngest = (): (() => Promise<void>) => {
  const host = ENV.TAK_STREAM_HOST;
  if (!host) {
    logger.info("tak ingest disabled (TAK_STREAM_HOST unset)");
    setStatus(TAK, "disabled");
    return async () => {};
  }

  let stopped = false;
  let socket: TLSSocket | undefined;
  let enrolled = false;

  /**
   * Ask RM to enrol our certificate as a TAK user. TAK completes the TLS
   * handshake for anything the RM CA signed, then drops the connection unless
   * the CN is a known TAK user — so without this the stream connects and closes
   * forever. takrmapi does the enrolling; only it has TAK's cert store.
   *
   * Idempotent on both sides, so a failure just means the next reconnect tries
   * again rather than the stream being stuck.
   */
  const enrol = async (): Promise<void> => {
    if (enrolled) return;
    try {
      await rmInteropAdd("tak");
      enrolled = true;
    } catch (err) {
      if (setStatus(TAK, "error", String(err))) {
        logger.error({ err }, "tak ingest: could not enrol our certificate with TAK");
      } else {
        logger.debug({ err }, "tak ingest: could not enrol our certificate (unchanged)");
      }
    }
  };

  const session = (): Promise<void> =>
    new Promise<void>((resolve) => {
      let buffer = "";
      let parseFailures = 0;
      // The client cert is read per connection so a re-issued cert is picked up
      // by a reconnect rather than needing a restart.
      const sock = connect({
        host,
        port: ENV.TAK_STREAM_PORT,
        servername: ENV.TAK_TLS_SERVERNAME || host,
        cert: readFileSync(ENV.TAK_CLIENT_CERT_PATH),
        key: readFileSync(ENV.TAK_CLIENT_KEY_PATH),
        ca: loadCaBundle(ENV.CA_PATH),
      });
      socket = sock;
      sock.setEncoding("utf8");

      sock.on("secureConnect", () => {
        setStatus(TAK, "connected");
        logger.info({ host, port: ENV.TAK_STREAM_PORT }, "tak ingest connected");
      });

      sock.on("data", (chunk: string) => {
        buffer += chunk;
        const { events, remaining } = extractCotEvents(buffer);
        buffer = remaining;
        for (const xml of events) {
          const cot = parseCotEvent(xml);
          if (!cot) {
            parseFailures += 1;
            if (parseFailures <= parseFailureLimit) {
              logger.warn({ xml: xml.slice(0, 500) }, "tak ingest: unparseable CoT, skipped");
            }
            continue;
          }
          // Fire and forget: a slow insert must not stall the socket, and one
          // failure must not cost us the rest of the batch.
          void ingest(cot).catch((err) => {
            logger.error({ err, uid: cot.uid }, "tak ingest: could not store event");
            setStatus(TAK, "connected", String(err));
          });
        }
      });

      sock.on("error", (err) => {
        // Includes the case that matters most: TAK accepting the TLS handshake
        // and then dropping us because our CN is not an enrolled TAK user.
        // Repeats of the same error drop to debug: this loop runs forever.
        const fresh = setStatus(TAK, "error", err.message);
        if (fresh) logger.error({ err, host }, "tak ingest: stream error");
        else logger.debug({ err, host }, "tak ingest: stream error (unchanged)");
      });

      sock.on("close", () => {
        socket = undefined;
        resolve();
      });
    });

  const run = async (): Promise<void> => {
    while (!stopped) {
      setStatus(TAK, "connecting");
      await enrol();
      if (stopped) return;
      try {
        await session();
      } catch (err) {
        // Reading the certificate files can fail before there is a socket at
        // all, most likely because container init has not written them yet.
        if (setStatus(TAK, "error", String(err))) {
          logger.error({ err }, "tak ingest: could not open the stream");
        } else {
          logger.debug({ err }, "tak ingest: could not open the stream (unchanged)");
        }
      }
      if (stopped) return;
      logger.debug({ delayMs: RECONNECT_DELAY_MS }, "tak ingest disconnected, reconnecting");
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
    }
  };

  void run();

  return async () => {
    stopped = true;
    setStatus(TAK, "disabled");
    socket?.destroy();
  };
};
