import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";
import { loadCaBundle, trustBundle } from "./ca-bundle.ts";

describe("trustBundle", () => {
  it("carries the public roots as well as the deployment's own", () => {
    // Node's `ca` option replaces the default trust store instead of adding to
    // it. Trusting only /ca_public meant every handshake with a peer holding a
    // publicly issued certificate failed with UNABLE_TO_GET_ISSUER_CERT_LOCALLY
    // — TAK's 8089 listener and nginx's mTLS endpoints both present the
    // deployment's Let's Encrypt certificate in production.
    const bundle = trustBundle("/nonexistent-ca-path");
    expect(bundle.length).toBeGreaterThanOrEqual(rootCertificates.length);
    expect(bundle).toEqual(expect.arrayContaining([rootCertificates[0]]));
  });

  it("adds the deployment CAs on top of them", () => {
    // The directory read is unchanged; this only asserts the union, so a future
    // change cannot quietly drop one side of it.
    const deployment = loadCaBundle("/ca_public");
    expect(trustBundle("/ca_public").length).toBe(rootCertificates.length + deployment.length);
  });
});
