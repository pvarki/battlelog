import { z } from "@hono/zod-openapi";

export const meResponseSchema = z
  .object({
    /** CN of the caller's client certificate, which PVARKI issues per callsign; null without one. */
    callsign: z.string().nullable(),
  })
  .openapi("Me");
