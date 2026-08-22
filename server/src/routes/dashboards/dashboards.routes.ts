import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { userIdentity } from "../../middleware/user-identity.ts";
import {
  createDashboardRequestSchema,
  dashboardResponseSchema,
  updateDashboardRequestSchema,
} from "./dashboards.apiSchema.ts";
import {
  deleteDashboardHandler,
  getDashboardHandler,
  listDashboardsHandler,
  patchDashboardHandler,
  postDashboardHandler,
} from "./dashboards.handlers.ts";

const errorResponseSchema = z.object({ error: z.string() }).openapi("ErrorResponse");

const jsonContent = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const dashboardIdParams = z.object({ dashboardId: z.string().uuid() });

export const listDashboardsRoute = createRoute({
  method: "get",
  path: "/dashboards",
  responses: {
    200: jsonContent(z.array(dashboardResponseSchema), "All dashboards, newest first"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

export const getDashboardRoute = createRoute({
  method: "get",
  path: "/dashboards/{dashboardId}",
  request: { params: dashboardIdParams },
  responses: {
    200: jsonContent(dashboardResponseSchema, "The dashboard"),
    400: jsonContent(errorResponseSchema, "Invalid dashboardId"),
    404: jsonContent(errorResponseSchema, "Dashboard not found"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

export const postDashboardRoute = createRoute({
  method: "post",
  path: "/dashboards",
  middleware: [userIdentity()] as const,
  request: { body: jsonContent(createDashboardRequestSchema, "Dashboard to create") },
  responses: {
    201: jsonContent(dashboardResponseSchema, "Created dashboard"),
    400: jsonContent(errorResponseSchema, "Invalid input"),
    401: jsonContent(errorResponseSchema, "Client certificate identity required"),
    409: jsonContent(errorResponseSchema, "A template with that name already exists"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

export const patchDashboardRoute = createRoute({
  method: "patch",
  path: "/dashboards/{dashboardId}",
  middleware: [userIdentity()] as const,
  request: {
    params: dashboardIdParams,
    body: jsonContent(updateDashboardRequestSchema, "Fields to update"),
  },
  responses: {
    200: jsonContent(dashboardResponseSchema, "Updated dashboard"),
    400: jsonContent(errorResponseSchema, "Invalid input"),
    401: jsonContent(errorResponseSchema, "Client certificate identity required"),
    404: jsonContent(errorResponseSchema, "Dashboard not found"),
    409: jsonContent(errorResponseSchema, "Version conflict — edited elsewhere"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

export const deleteDashboardRoute = createRoute({
  method: "delete",
  path: "/dashboards/{dashboardId}",
  middleware: [userIdentity()] as const,
  request: { params: dashboardIdParams },
  responses: {
    204: { description: "Deleted" },
    400: jsonContent(errorResponseSchema, "Invalid dashboardId"),
    401: jsonContent(errorResponseSchema, "Client certificate identity required"),
    404: jsonContent(errorResponseSchema, "Dashboard not found"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

// Chained so `typeof dashboardRoutes` carries route types for hono/client RPC.
export const dashboardRoutes = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) return c.json({ error: "Invalid input format" }, 400);
  },
})
  .openapi(listDashboardsRoute, listDashboardsHandler)
  .openapi(postDashboardRoute, postDashboardHandler)
  .openapi(getDashboardRoute, getDashboardHandler)
  .openapi(patchDashboardRoute, patchDashboardHandler)
  .openapi(deleteDashboardRoute, deleteDashboardHandler);

export type DashboardsApi = typeof dashboardRoutes;
