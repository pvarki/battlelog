import "varlock/auto-load";
import { ENV } from "varlock/env";
import { expect, test, vi } from "vitest";
import { createApp } from "./app.ts";
import { eventRoutes } from "./routes/events/events.routes.ts";

vi.mock("./services/events/events.service.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getEvent: vi.fn().mockRejectedValue(new Error("pg: duplicate key violates events_pkey")),
}));

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

test("event routes are registered in the OpenAPI spec", () => {
  const spec = eventRoutes.getOpenAPI31Document({
    openapi: "3.1.0",
    info: { title: "test", version: "0" },
  });
  expect(Object.keys(spec.paths ?? {})).toEqual(
    expect.arrayContaining(["/events", "/events/{eventId}"]),
  );
  expect(spec.paths?.["/events"]?.get?.parameters?.length).toBeGreaterThan(10);
});

test("unhandled errors return a generic 500 without internal details", async () => {
  const app = createApp();
  const res = await app.request("/api/v1/events/018f0000-0000-7000-8000-000000000000");
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "Internal server error" });
});

test("rmapi routes are gated by RM_API_ENABLED", async () => {
  const app = createApp();
  const res = await app.request("/rmapi/api/v1/healthcheck");
  expect(res.status).toBe(ENV.RM_API_ENABLED ? 200 : 404);
});
