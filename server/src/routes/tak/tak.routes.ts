import "varlock/auto-load";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { ENV } from "varlock/env";
import { logger } from "../../lib/logger.ts";
import { takState } from "../../services/tak/tak.client.ts";
import type { TakStateChange } from "../../services/tak/tak.state.ts";
import { takMissionSchema, takStateResponseSchema } from "./tak.apiSchema.ts";

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

export const getTakMissionsRoute = createRoute({
  method: "get",
  path: "/tak/missions",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(takMissionSchema) } },
      description: "TAK missions (Data Sync feeds) with their current contents",
    },
  },
});

const toSSE = (change: TakStateChange) => {
  if (change.kind === "upsert") return { event: "upsert", data: JSON.stringify(change.feature) };
  if (change.kind === "delete") return { event: "delete", data: JSON.stringify({ id: change.id }) };
  return { event: "missions", data: JSON.stringify(change.missions) };
};

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
        .writeSSE(toSSE(change))
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
    // Before the first poll, an empty list would read as "every mission is gone".
    if (takState.missionsLoaded()) {
      await stream.writeSSE(toSSE({ kind: "missions", missions: takState.missions() }));
    }
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
  )
  .openapi(getTakMissionsRoute, (c) => c.json(takState.missions(), 200));

export type TakApi = typeof takRoutes;
