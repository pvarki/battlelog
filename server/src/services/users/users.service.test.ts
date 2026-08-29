import "varlock/auto-load";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool } from "../../db/client.ts";
import { users } from "../../db/schema.ts";
import { checkDbUp } from "../../db/test-helpers.ts";
import { certCnFromPem, findUserByCn } from "./users.service.ts";

/**
 * Only the pure part is unit-tested. The rest of this service is three upserts
 * whose behaviour is the DB's, and the integration suites cover that.
 */

/** Throwaway self-signed cert, CN=battlelog-test. Nothing trusts it. */
const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBqjCCAU+gAwIBAgIUHb0kRCNlQ5xPqAO5oE0oo9mrB9UwCgYIKoZIzj0EAwIw
KjEXMBUGA1UEAwwOYmF0dGxlbG9nLXRlc3QxDzANBgNVBAoMBnB2YXJraTAeFw0y
NjA4MjUxMTA0MjJaFw0zNjA4MjIxMTA0MjJaMCoxFzAVBgNVBAMMDmJhdHRsZWxv
Zy10ZXN0MQ8wDQYDVQQKDAZwdmFya2kwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC
AASSpxTHp6gWMI748Z3UTcAX1KIgYvMAD+RTNKCb+yrx8o3z8/zal1QahvbG3wvN
Qw5PYiR4CmRitqoCz1eHZb3mo1MwUTAdBgNVHQ4EFgQUn7UikidF/N2AIQfxAvnO
KXC8fekwHwYDVR0jBBgwFoAUn7UikidF/N2AIQfxAvnOKXC8fekwDwYDVR0TAQH/
BAUwAwEB/zAKBggqhkjOPQQDAgNJADBGAiEA/bdmENE2raxhMvB9Y7NijF1/jvhv
yPuPa0slMthT6AsCIQCVCe5LOh6cjYqSvIXOx1jfCiWxJo5OJzs737eXZFflOQ==
-----END CERTIFICATE-----`;

describe("certCnFromPem", () => {
  test("reads the CN, unescaping the newlines RM sends", () => {
    // RM posts the PEM in CFSSL conventions, ie with the newlines escaped.
    expect(certCnFromPem(CERT_PEM.replace(/\n/g, "\\n"))).toBe("battlelog-test");
  });

  test("accepts a real PEM with literal newlines too", () => {
    expect(certCnFromPem(CERT_PEM)).toBe("battlelog-test");
  });

  test("returns undefined rather than throwing on anything unusable", () => {
    // Not fatal on purpose: the hook must still record the user, and the
    // callsign is a usable identity on its own.
    expect(certCnFromPem("")).toBeUndefined();
    expect(certCnFromPem("FIXME: insert dummy cert in CFSSL encoding")).toBeUndefined();
    expect(certCnFromPem("-----BEGIN CERTIFICATE-----\\nnot base64\\n")).toBeUndefined();
  });
});

// Integration test: requires a database, and it is the one that matters most in
// this file — resolving a caller to the wrong row hands them that row's
// privileges.
const dbUp = await checkDbUp("users.service CN resolution test");

describe.runIf(dbUp)("findUserByCn", () => {
  const runId = `cn-test-${Date.now()}`;
  const admin = { uuid: `${runId}-admin`, callsign: `${runId}-ADMIN`, certCn: `${runId}-admin-cn` };
  const other = { uuid: `${runId}-other`, callsign: `${runId}-OTHER`, certCn: null };

  beforeAll(async () => {
    await db.insert(users).values([
      { ...admin, isAdmin: true },
      { ...other, isAdmin: false },
    ]);
  });
  afterAll(async () => {
    await db.delete(users).where(inArray(users.uuid, [admin.uuid, other.uuid]));
    await pool.end();
  });

  test("resolves by cert CN", async () => {
    expect((await findUserByCn(admin.certCn))?.uuid).toBe(admin.uuid);
  });

  test("an admin's callsign does not resolve to the admin when their CN is known", async () => {
    // The privilege-confusion case: a caller presenting a cert whose CN happens
    // to equal an admin's callsign must not become that admin.
    expect(await findUserByCn(admin.callsign)).toBeUndefined();
  });

  test("falls back to the callsign only for a row with no CN recorded", async () => {
    // RM's created hook may not carry a parseable cert, and such a user still
    // has to be resolvable by the only identity they have.
    expect((await findUserByCn(other.callsign))?.uuid).toBe(other.uuid);
  });
});
