import type { DashboardsApi } from "@server/routes/dashboards/dashboards.routes.ts";
import type { EventsApi } from "@server/routes/events/events.routes.ts";
import { hc } from "hono/client";

export type { DashboardResponse, Widget } from "@server/routes/dashboards/dashboards.apiSchema.ts";
export type { EventResponse } from "@server/routes/events/events.apiSchema.ts";

// Same-origin: Hono serves the SPA and mounts the API under /api/v1.
export const api = hc<EventsApi>("/api/v1");
export const dashboardsApi = hc<DashboardsApi>("/api/v1");
