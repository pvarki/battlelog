import "varlock/auto-load";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { ENV } from "varlock/env";
import { logger } from "../../lib/logger.ts";
import { type TakStateChange, takState } from "../../services/tak/tak.state.ts";
import { takStateResponseSchema } from "./tak.apiSchema.ts";

export const getTakStateRoute = createRoute({
  method: "get",
  path: "/tak/state",
  responses: {
    200: {
      content: { "application/json": { schema: takStateResponseSchema } },
      description: "Current TAK map picture: units, contacts, markers, drawings, routes",
    },
  },
});

// A client this far behind reconnects and gets a fresh snapshot instead.
const MAX_UNSENT = 1000;

/** SSE: one `snapshot` event, then `upsert` / `delete` changes as they happen. */
const streamTakState = (c: Context) =>
  streamSSE(c, async (stream) => {
    let unsent = 0;
    const send = (change: TakStateChange) => {
      if (++unsent > MAX_UNSENT) {
        logger.warn("tak SSE client too slow, closing");
        void stream.close();
        return Promise.resolve();
      }
      return stream
        .writeSSE(
          change.kind === "upsert"
            ? { event: "upsert", data: JSON.stringify(change.feature) }
            : { event: "delete", data: JSON.stringify({ id: change.id }) },
        )
        .catch((err) => logger.error({ err }, "tak SSE write failed"))
        .finally(() => {
          unsent--;
        });
    };

    // Subscribe before snapshotting so no change falls between the two; a
    // duplicate upsert after the snapshot is harmless to the client.
    const pending: TakStateChange[] = [];
    let live = false;
    const unsubscribe = takState.onChange((change) => {
      if (live) void send(change);
      else if (pending.length < MAX_UNSENT) pending.push(change);
      else void stream.close();
    });
    stream.onAbort(() => unsubscribe());

    await stream.writeSSE({
      event: "snapshot",
      data: JSON.stringify({ enabled: ENV.TAK_ENABLED, items: takState.snapshot() }),
    });
    for (const change of pending) await send(change);
    live = true;

    while (!stream.aborted) {
      await stream.sleep(15000);
      if (stream.aborted) break;
      await stream.writeSSE({ event: "ping", data: "" });
    }
  });

// Chained so `typeof takRoutes` keeps the typed route for the web client; SSE
// stays outside OpenAPI like /events/stream.
export const takRoutes = new OpenAPIHono()
  .route("/", new OpenAPIHono().get("/tak/stream", streamTakState))
  .openapi(getTakStateRoute, (c) =>
    c.json({ enabled: ENV.TAK_ENABLED, items: takState.snapshot() }, 200),
  );

export type TakApi = typeof takRoutes;
