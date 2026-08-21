import type { EventsApi } from "@server/routes/events/events.routes.ts";
import { hc } from "hono/client";

export type { EventResponse } from "@server/routes/events/events.apiSchema.ts";

// Same-origin: Hono serves the SPA and mounts the API under /api/v1.
export const api = hc<EventsApi>("/api/v1");
