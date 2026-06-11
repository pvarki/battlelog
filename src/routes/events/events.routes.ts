import { Hono } from "hono";
import { generalRateLimit, strictRateLimit } from "../../middleware/rate-limit.ts";
import {
  getEventHandler,
  listEventsHandler,
  patchEvent,
  postEvent,
  streamNewEvents,
} from "./events.handlers.ts";

export const eventRoutes = new Hono();

eventRoutes.post("/events", strictRateLimit, postEvent);
eventRoutes.get("/events", generalRateLimit, listEventsHandler);
eventRoutes.get("/events/stream", generalRateLimit, streamNewEvents);
eventRoutes.get("/events/:eventId", generalRateLimit, getEventHandler);
eventRoutes.patch("/events/:eventId", strictRateLimit, patchEvent);
