import "varlock/auto-load";
import { ENV } from "varlock/env";
import { expect, test } from "vitest";
import { createApp } from "./app.ts";

test("createApp returns a Hono app that responds 200 on /healthz", async () => {
  const app = createApp();
  const res = await app.request("/healthz");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
});

test("createApp sets permissive CORS headers", async () => {
  const app = createApp();
  const res = await app.request("/healthz", {
    method: "OPTIONS",
    headers: { Origin: "http://x", "Access-Control-Request-Method": "GET" },
  });
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
});

test("rmapi routes are gated by RM_API_ENABLED", async () => {
  const app = createApp();
  const res = await app.request("/rmapi/api/v1/healthcheck");
  expect(res.status).toBe(ENV.RM_API_ENABLED ? 200 : 404);
});
