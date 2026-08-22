import "varlock/auto-load";
import { Hono } from "hono";
import { expect, test } from "vitest";
import { userIdentity } from "../../middleware/user-identity.ts";
import { requireRmCaller, rmRoutes } from "./rmapi.routes.ts";

test("healthcheck responds without auth", async () => {
  const res = await rmRoutes.request("/api/v1/healthcheck");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ healthy: true });
});

test("v2 description carries the home-grid card", async () => {
  const res = await rmRoutes.request("/api/v2/description/fi");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ shortname: "bl", language: "fi" });
  expect(body.component.type).toBe("link");
  expect(body.docs).toBeTruthy();
});

// RM's v1 ProductDescription model is extra="forbid": any extra key makes RM
// drop the product from the list entirely, so v1 must stay trimmed.
test("v1 description omits the v2-only fields", async () => {
  const res = await rmRoutes.request("/api/v1/description/en");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual([
    "description",
    "icon",
    "language",
    "shortname",
    "title",
  ]);
});

// Serving this would list BattleLog under admin tools as well as the main grid.
test("v2 admin description 404s so the card is not duplicated", async () => {
  const res = await rmRoutes.request("/api/v2/admin/description/en");
  expect(res.status).toBe(404);
});

test("unknown language falls back to en", async () => {
  const res = await rmRoutes.request("/api/v2/description/xx");
  expect(res.status).toBe(200);
  expect((await res.json()).language).toBe("en");
});

test("user lifecycle webhooks acknowledge", async () => {
  const res = await rmRoutes.request("/api/v1/users/created", { method: "POST" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true });
});

const enforced = requireRmCaller({
  enforce: true,
  header: "x-clientcert-dn",
  expectedCn: "rasenmaeher",
});
const harness = new Hono();
harness.get("/gated", enforced, (c) => c.json({ ok: true }));

test("enforcement: missing header -> 401", async () => {
  const res = await harness.request("/gated");
  expect(res.status).toBe(401);
});

test("enforcement: malformed DN -> 401", async () => {
  const res = await harness.request("/gated", { headers: { "x-clientcert-dn": "garbage" } });
  expect(res.status).toBe(401);
});

test("enforcement: wrong CN -> 403", async () => {
  const res = await harness.request("/gated", {
    headers: { "x-clientcert-dn": "/O=PVARKI/CN=intruder" },
  });
  expect(res.status).toBe(403);
});

test("enforcement: expected CN -> 200", async () => {
  const res = await harness.request("/gated", {
    headers: { "x-clientcert-dn": "/O=PVARKI/CN=rasenmaeher" },
  });
  expect(res.status).toBe(200);
});

const idHarness = new Hono();
idHarness.post("/write", userIdentity({ header: "x-clientcert-dn", required: true }), (c) =>
  c.json({ user: c.get("userCn") }),
);
idHarness.post("/lax", userIdentity({ header: "x-clientcert-dn", required: false }), (c) =>
  c.json({ user: c.get("userCn") ?? "anonymous" }),
);

test("user identity: required write without cert -> 401", async () => {
  const res = await idHarness.request("/write", { method: "POST" });
  expect(res.status).toBe(401);
});

test("user identity: CN flows into context", async () => {
  const res = await idHarness.request("/write", {
    method: "POST",
    headers: { "x-clientcert-dn": "CN=KETTU23a, O=PVARKI" },
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ user: "KETTU23a" });
});

test("user identity: not required falls back to anonymous", async () => {
  const res = await idHarness.request("/lax", { method: "POST" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ user: "anonymous" });
});
