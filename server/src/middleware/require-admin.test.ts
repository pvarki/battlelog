import { Hono } from "hono";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { UserRow } from "../db/schema.ts";
import { findUserByCn } from "../services/users/users.service.ts";
import { requireAdmin } from "./require-admin.ts";

// DB-free: the gate only touches the DB through findUserByCn.
vi.mock("../services/users/users.service.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../services/users/users.service.ts")>();
  return { ...orig, findUserByCn: vi.fn() };
});

const user = (over: Partial<UserRow>): UserRow => ({
  uuid: "u-1",
  callsign: "ALPHA-1",
  certCn: "ALPHA-1",
  isAdmin: false,
  revokedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

// The gate reads userCn off the context, so set it directly rather than
// dragging the DN-header middleware into a test about authorisation.
const app = new Hono()
  .use("*", async (c, next) => {
    const cn = c.req.header("x-test-cn");
    c.set("userCn", cn);
    return next();
  })
  .use("*", requireAdmin())
  .get("/guarded", (c) => c.json({ ok: true }));

const call = (cn?: string) => app.request("/guarded", { headers: cn ? { "x-test-cn": cn } : {} });

describe("requireAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  test("an admin passes", async () => {
    vi.mocked(findUserByCn).mockResolvedValue(user({ isAdmin: true }));
    const res = await call("ALPHA-1");
    expect(res.status).toBe(200);
  });

  test("a known non-admin is refused", async () => {
    vi.mocked(findUserByCn).mockResolvedValue(user({ isAdmin: false }));
    expect((await call("ALPHA-1")).status).toBe(403);
  });

  test("a user RM never told us about is not an admin", async () => {
    vi.mocked(findUserByCn).mockResolvedValue(undefined);
    expect((await call("STRANGER")).status).toBe(403);
  });

  test("a revoked admin is refused", async () => {
    vi.mocked(findUserByCn).mockResolvedValue(user({ isAdmin: true, revokedAt: new Date() }));
    expect((await call("ALPHA-1")).status).toBe(403);
  });

  test("no client certificate identity is 401, not 403", async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(findUserByCn).not.toHaveBeenCalled();
  });
});
