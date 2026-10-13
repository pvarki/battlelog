import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { userIdentity } from "../../middleware/user-identity.ts";
import { meResponseSchema } from "./me.apiSchema.ts";

export const getMeRoute = createRoute({
  method: "get",
  path: "/me",
  middleware: [userIdentity({ required: false })] as const,
  responses: {
    200: {
      content: { "application/json": { schema: meResponseSchema } },
      description: "Who the caller is",
    },
  },
});

export const meRoutes = new OpenAPIHono().openapi(getMeRoute, (c) =>
  c.json({ callsign: c.get("userCn") ?? null }, 200),
);

export type MeApi = typeof meRoutes;
