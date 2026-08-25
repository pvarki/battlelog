import { createMiddleware } from "hono/factory";
import { logger } from "../lib/logger.ts";
import { findUserByCn } from "../services/users/users.service.ts";

/**
 * Gate for endpoints only a Deploy App admin may use. Runs after
 * {@link userIdentity}, which puts the caller's cert CN on the context.
 *
 * Admin status comes from RM through the /rmapi user lifecycle hooks, so this is
 * only as current as the last hook RM delivered. A user RM never told us about
 * is not an admin, which is the safe direction.
 */
export const requireAdmin = () =>
  createMiddleware(async (c, next) => {
    const cn = c.get("userCn");
    if (!cn) {
      return c.json({ error: "Client certificate identity required" }, 401);
    }
    const user = await findUserByCn(cn);
    if (!user?.isAdmin || user.revokedAt) {
      logger.warn({ cn, known: Boolean(user) }, "rejected non-admin request");
      return c.json({ error: "Admin privileges required" }, 403);
    }
    return next();
  });
