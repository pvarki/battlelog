import "varlock/auto-load";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { ENV } from "varlock/env";
import { extractClientIp } from "../lib/client-ip.js";

const keyFromContext = (c: Context): string => {
  const xff = c.req.header("x-forwarded-for");
  let remoteAddr: string | undefined;
  try {
    remoteAddr = getConnInfo(c).remote.address;
  } catch {
    remoteAddr = undefined;
  }
  remoteAddr = remoteAddr ?? c.req.header("x-real-ip") ?? "unknown";
  return extractClientIp({ xff, remoteAddr, hops: ENV.BL_TRUST_PROXY_HOPS });
};

export const generalRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 2000,
  standardHeaders: "draft-7",
  keyGenerator: keyFromContext,
  message: { error: "Too many requests from this IP, please try again later." },
});

export const strictRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  keyGenerator: keyFromContext,
  message: { error: "Too many write requests from this IP, please try again later." },
});

export const uploadRateLimit = rateLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 50,
  standardHeaders: "draft-7",
  keyGenerator: keyFromContext,
  message: { error: "Too many upload requests from this IP, please try again later." },
});
