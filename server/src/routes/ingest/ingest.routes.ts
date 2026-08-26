import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireAdmin } from "../../middleware/require-admin.ts";
import { userIdentity } from "../../middleware/user-identity.ts";
import {
  createIngestSourceRequestSchema,
  createMatrixRoomRequestSchema,
  errorResponseSchema,
  ingestSourceNameSchema,
  ingestSourceResponseSchema,
  matrixRoomResponseSchema,
  transportStatusResponseSchema,
  updateIngestSourceRequestSchema,
} from "./ingest.apiSchema.ts";
import {
  createMatrixRoomHandler,
  deleteIngestSourceHandler,
  listIngestSourceNamesHandler,
  listIngestSourcesHandler,
  listMatrixRoomsHandler,
  patchIngestSourceHandler,
  postIngestSourceHandler,
  transportStatusHandler,
} from "./ingest.handlers.ts";

/**
 * What gets ingested into the feed, chosen at runtime.
 *
 * Everything here is admin-only, including the reads: an ingest source's config
 * says which TAK feeds and Matrix rooms a deployment watches, which is not
 * something every user needs to see.
 *
 * Admin status comes from RM through the /rmapi user lifecycle hooks.
 */

const jsonContent = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const sourceIdParams = z.object({ sourceId: z.string().uuid() });

const adminErrors = {
  401: jsonContent(errorResponseSchema, "Client certificate identity required"),
  403: jsonContent(errorResponseSchema, "Admin privileges required"),
  500: jsonContent(errorResponseSchema, "Server error"),
};

export const listIngestSourcesRoute = createRoute({
  method: "get",
  path: "/ingest/sources",
  middleware: [userIdentity({ required: true }), requireAdmin()] as const,
  responses: {
    200: jsonContent(z.array(ingestSourceResponseSchema), "Configured ingest sources"),
    ...adminErrors,
  },
});

export const listIngestSourceNamesRoute = createRoute({
  method: "get",
  path: "/ingest/names",
  // Not admin-gated: names are what a feed widget picks by, and they carry
  // nothing a dashboard author should not see.
  middleware: [userIdentity()] as const,
  responses: {
    200: jsonContent(z.array(ingestSourceNameSchema), "Ingest setups, names only"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

export const postIngestSourceRoute = createRoute({
  method: "post",
  path: "/ingest/sources",
  middleware: [userIdentity({ required: true }), requireAdmin()] as const,
  request: { body: jsonContent(createIngestSourceRequestSchema, "Source to add") },
  responses: {
    201: jsonContent(ingestSourceResponseSchema, "Created source"),
    400: jsonContent(errorResponseSchema, "Invalid input"),
    ...adminErrors,
  },
});

export const patchIngestSourceRoute = createRoute({
  method: "patch",
  path: "/ingest/sources/{sourceId}",
  middleware: [userIdentity({ required: true }), requireAdmin()] as const,
  request: {
    params: sourceIdParams,
    body: jsonContent(updateIngestSourceRequestSchema, "Fields to change"),
  },
  responses: {
    200: jsonContent(ingestSourceResponseSchema, "Updated source"),
    400: jsonContent(errorResponseSchema, "Invalid input"),
    404: jsonContent(errorResponseSchema, "Source not found"),
    ...adminErrors,
  },
});

export const deleteIngestSourceRoute = createRoute({
  method: "delete",
  path: "/ingest/sources/{sourceId}",
  middleware: [userIdentity({ required: true }), requireAdmin()] as const,
  request: { params: sourceIdParams },
  responses: {
    204: { description: "Deleted" },
    400: jsonContent(errorResponseSchema, "Invalid sourceId"),
    404: jsonContent(errorResponseSchema, "Source not found"),
    ...adminErrors,
  },
});

export const transportStatusRoute = createRoute({
  method: "get",
  path: "/ingest/status",
  middleware: [userIdentity({ required: true }), requireAdmin()] as const,
  responses: {
    200: jsonContent(transportStatusResponseSchema, "Live state of each ingester"),
    ...adminErrors,
  },
});

export const createMatrixRoomRoute = createRoute({
  method: "post",
  path: "/ingest/matrix/rooms",
  middleware: [userIdentity({ required: true }), requireAdmin()] as const,
  request: { body: jsonContent(createMatrixRoomRequestSchema, "Room to create") },
  responses: {
    201: jsonContent(z.object({ roomId: z.string() }), "Created room"),
    400: jsonContent(errorResponseSchema, "Invalid input"),
    503: jsonContent(errorResponseSchema, "Matrix is not configured or not reachable"),
    ...adminErrors,
  },
});

export const listMatrixRoomsRoute = createRoute({
  method: "get",
  path: "/ingest/matrix/rooms",
  middleware: [userIdentity({ required: true }), requireAdmin()] as const,
  responses: {
    200: jsonContent(z.array(matrixRoomResponseSchema), "Rooms in the deployment's Space"),
    503: jsonContent(errorResponseSchema, "Matrix is not configured or not reachable"),
    ...adminErrors,
  },
});

// Chained so `typeof ingestRoutes` carries route types for hono/client RPC.
export const ingestRoutes = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) return c.json({ error: "Invalid input format" }, 400);
  },
})
  .openapi(listIngestSourcesRoute, listIngestSourcesHandler)
  .openapi(listIngestSourceNamesRoute, listIngestSourceNamesHandler)
  .openapi(postIngestSourceRoute, postIngestSourceHandler)
  .openapi(transportStatusRoute, transportStatusHandler)
  .openapi(listMatrixRoomsRoute, listMatrixRoomsHandler)
  .openapi(createMatrixRoomRoute, createMatrixRoomHandler)
  .openapi(patchIngestSourceRoute, patchIngestSourceHandler)
  .openapi(deleteIngestSourceRoute, deleteIngestSourceHandler);

export type IngestApi = typeof ingestRoutes;
