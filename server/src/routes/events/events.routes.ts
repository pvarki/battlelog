import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { userIdentity } from "../../middleware/user-identity.ts";
import {
  createEventRequestSchema,
  errorResponseSchema,
  eventResponseSchema,
  eventsQuerySchema,
  updateEventRequestSchema,
} from "./events.apiSchema.ts";
import {
  getEventHandler,
  listEventsHandler,
  patchEvent,
  postEvent,
  streamNewEvents,
} from "./events.handlers.ts";

const jsonContent = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const eventIdParams = z.object({ eventId: z.string().uuid() });

export const postEventRoute = createRoute({
  method: "post",
  path: "/events",
  middleware: [userIdentity()] as const,
  request: {
    body: jsonContent(createEventRequestSchema, "Event to create"),
  },
  responses: {
    201: jsonContent(eventResponseSchema, "Created event"),
    400: jsonContent(errorResponseSchema, "Invalid input"),
    401: jsonContent(errorResponseSchema, "Client certificate identity required"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

export const listEventsRoute = createRoute({
  method: "get",
  path: "/events",
  request: { query: eventsQuerySchema },
  responses: {
    200: jsonContent(
      z.array(eventResponseSchema),
      "Matching events (current heads unless includeHistory=true)",
    ),
    400: jsonContent(errorResponseSchema, "Invalid filter"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

export const getEventRoute = createRoute({
  method: "get",
  path: "/events/{eventId}",
  request: { params: eventIdParams },
  responses: {
    200: jsonContent(eventResponseSchema, "Current head version of the event"),
    400: jsonContent(errorResponseSchema, "Invalid eventId"),
    404: jsonContent(errorResponseSchema, "Event not found"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

export const patchEventRoute = createRoute({
  method: "patch",
  path: "/events/{eventId}",
  middleware: [userIdentity()] as const,
  request: {
    params: eventIdParams,
    body: jsonContent(updateEventRequestSchema, "Fields to change; inserts a new version row"),
  },
  responses: {
    200: jsonContent(eventResponseSchema, "New head version"),
    400: jsonContent(errorResponseSchema, "Invalid input"),
    401: jsonContent(errorResponseSchema, "Client certificate identity required"),
    404: jsonContent(errorResponseSchema, "Event not found"),
    409: jsonContent(errorResponseSchema, "Concurrent update — fetch the latest version and retry"),
    500: jsonContent(errorResponseSchema, "Server error"),
  },
});

// Registrations are chained so `typeof eventRoutes` carries every route's
// request/response types — the web app's hono/client RPC relies on it.
// SSE stays outside the OpenAPI surface and is mounted via .route() (a bare
// .get() would collapse the chain to plain Hono); it comes first so the
// static path wins over /events/{eventId}.
export const eventRoutes = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) return c.json({ error: "Invalid input format" }, 400);
  },
})
  .route("/", new OpenAPIHono().get("/events/stream", streamNewEvents))
  .openapi(postEventRoute, postEvent)
  .openapi(listEventsRoute, listEventsHandler)
  .openapi(getEventRoute, getEventHandler)
  .openapi(patchEventRoute, patchEvent);

export type EventsApi = typeof eventRoutes;
