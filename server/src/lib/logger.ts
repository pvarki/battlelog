import "varlock/auto-load";
import pino from "pino";
import { ENV } from "varlock/env";

// ponytail: stdout only. The pino-opentelemetry-transport worker stream this
// used to attach under NODE_ENV=production exited on its own and made the next
// log write throw "the worker has exited", killing the process seconds after
// boot. Container stdout already carries structured JSON for a collector to
// scrape. To re-add OTLP log export: gate it on OTEL_EXPORTER_OTLP_ENDPOINT the
// way instrumentation.ts does, and handle the stream's 'error' event.
export const logger = pino({
  level: ENV.LOG_LEVEL,
  base: { service: "battlelog" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
