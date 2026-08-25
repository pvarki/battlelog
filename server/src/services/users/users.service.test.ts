import { describe, expect, test } from "vitest";
import { certCnFromPem } from "./users.service.ts";

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
