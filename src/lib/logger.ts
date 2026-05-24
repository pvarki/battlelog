import "varlock/auto-load";
import pino, { type StreamEntry } from "pino";
import { ENV } from "varlock/env";

const streams: StreamEntry[] = [
  { level: ENV.LOG_LEVEL, stream: process.stdout },
  { level: "error", stream: pino.destination({ dest: "error.log", sync: false, mkdir: true }) },
  {
    level: ENV.LOG_LEVEL,
    stream: pino.destination({ dest: "combined.log", sync: false, mkdir: true }),
  },
];

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
