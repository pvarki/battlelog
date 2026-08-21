import "varlock/auto-load";
import pino, { type StreamEntry } from "pino";
import { ENV } from "varlock/env";

const streams: StreamEntry[] = [{ level: ENV.LOG_LEVEL, stream: process.stdout }];

if (ENV.NODE_ENV === "production") {
  streams.push({
    level: ENV.LOG_LEVEL,
    stream: pino.transport({ target: "pino-opentelemetry-transport" }),
  });
}

export const logger = pino(
  {
    level: ENV.LOG_LEVEL,
    base: { service: "battlelog" },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream(streams),
);
