import "varlock/auto-load";
import { createMiddleware } from "hono/factory";
import { ENV } from "varlock/env";
import { cnFromDn } from "../lib/client-cert.ts";

declare module "hono" {
  interface ContextVariableMap {
    /** CN of the caller's mTLS client cert, injected by the Deploy App proxy. */
    userCn: string | undefined;
  }
}

/**
 * Resolves the caller's identity from the proxy-injected client-cert DN header
 * (each user has their own device cert; the CN identifies them). With
 * `required` (writes, when RM_MTLS_USER_ENFORCE=true) requests without a valid
 * CN are rejected — the proxy is the trust boundary, so a missing header means
 * the request did not come through it.
 */
export const userIdentity = (opts?: { header?: string; required?: boolean }) =>
  createMiddleware(async (c, next) => {
    const header = opts?.header ?? ENV.RM_MTLS_HEADER;
    const required = opts?.required ?? ENV.RM_MTLS_USER_ENFORCE;
    const cn = cnFromDn(c.req.header(header));
    c.set("userCn", cn);
    if (required && !cn) {
      return c.json({ error: "Client certificate identity required" }, 401);
    }
    return next();
  });
