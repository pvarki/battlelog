import type { RouteHandler } from "@hono/zod-openapi";
import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
  VersionConflictError,
} from "../../services/dashboards/dashboards.service.ts";
import { toApiDashboard } from "./dashboards.apiSchema.ts";
import type {
  deleteDashboardRoute,
  getDashboardRoute,
  listDashboardsRoute,
  patchDashboardRoute,
  postDashboardRoute,
} from "./dashboards.routes.ts";

export const listDashboardsHandler: RouteHandler<typeof listDashboardsRoute> = async (c) => {
  const rows = await listDashboards();
  return c.json(rows.map(toApiDashboard), 200);
};

export const getDashboardHandler: RouteHandler<typeof getDashboardRoute> = async (c) => {
  const { dashboardId } = c.req.valid("param");
  const row = await getDashboard(dashboardId);
  if (!row) return c.json({ error: "Dashboard not found" }, 404);
  return c.json(toApiDashboard(row), 200);
};

export const postDashboardHandler: RouteHandler<typeof postDashboardRoute> = async (c) => {
  // "anonymous" only when RM_MTLS_USER_ENFORCE is off (local dev without the proxy)
  const user = c.get("userCn") ?? "anonymous";
  const body = c.req.valid("json");
  const row = await createDashboard({ ...body, createdBy: user });
  return c.json(toApiDashboard(row), 201);
};

export const patchDashboardHandler: RouteHandler<typeof patchDashboardRoute> = async (c) => {
  const { dashboardId } = c.req.valid("param");
  const user = c.get("userCn") ?? "anonymous";
  const { version, ...patch } = c.req.valid("json");
  try {
    const row = await updateDashboard(dashboardId, patch, user, version);
    if (!row) return c.json({ error: "Dashboard not found" }, 404);
    return c.json(toApiDashboard(row), 200);
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return c.json({ error: "Dashboard was edited elsewhere; reload and retry" }, 409);
    }
    throw err;
  }
};

export const deleteDashboardHandler: RouteHandler<typeof deleteDashboardRoute> = async (c) => {
  const { dashboardId } = c.req.valid("param");
  const deleted = await deleteDashboard(dashboardId);
  if (!deleted) return c.json({ error: "Dashboard not found" }, 404);
  return c.body(null, 204);
};
