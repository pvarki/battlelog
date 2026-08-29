import "varlock/auto-load";
import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";
import { userIdentity } from "../../middleware/user-identity.ts";
import { revokeUser, setUserAdmin, upsertUser } from "../../services/users/users.service.ts";
import { requireRmCaller, rmRoutes } from "./rmapi.routes.ts";

// DB-free: the user hooks only touch the DB through these three.
vi.mock("../../services/users/users.service.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../services/users/users.service.ts")>();
  return { ...orig, upsertUser: vi.fn(), revokeUser: vi.fn(), setUserAdmin: vi.fn() };
});

beforeEach(() => vi.clearAllMocks());

const rmUser = { uuid: "u-1", callsign: "NORPPA11", x509cert: "" };

const postUser = (path: string, body: unknown = rmUser, method = "POST") =>
  rmRoutes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

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

test("created records the user", async () => {
  const res = await postUser("/api/v1/users/created");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true });
  expect(upsertUser).toHaveBeenCalledWith(rmUser);
});

test("promoted upserts first, so it works for a user we never saw created", async () => {
  const res = await postUser("/api/v1/users/promoted");
  expect(res.status).toBe(200);
  expect(upsertUser).toHaveBeenCalledWith(rmUser);
  expect(setUserAdmin).toHaveBeenCalledWith("u-1", true);
});

test("demoted clears admin, revoked marks the cert gone", async () => {
  expect((await postUser("/api/v1/users/demoted")).status).toBe(200);
  expect(setUserAdmin).toHaveBeenCalledWith("u-1", false);
  expect((await postUser("/api/v1/users/revoked")).status).toBe(200);
  expect(revokeUser).toHaveBeenCalledWith("u-1");
});

test("updated is a PUT and re-records the user", async () => {
  expect((await postUser("/api/v1/users/updated", rmUser, "PUT")).status).toBe(200);
  expect(upsertUser).toHaveBeenCalledWith(rmUser);
});

test("an unusable body is refused rather than silently ignored", async () => {
  const res = await postUser("/api/v1/users/created", { callsign: "NORPPA11" });
  expect(res.status).toBe(400);
  expect(upsertUser).not.toHaveBeenCalled();
});

// RM treats a failure as a provisioning error, so a transient DB problem has to
// answer honestly rather than pretending the hook was applied.
test("a failed write answers 500, not success", async () => {
  vi.mocked(upsertUser).mockRejectedValueOnce(new Error("db down"));
  const res = await postUser("/api/v1/users/created");
  expect(res.status).toBe(500);
  expect(await res.json()).toMatchObject({ success: false });
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
