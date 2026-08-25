import "varlock/auto-load";
import { readFileSync } from "node:fs";
import { Agent, request } from "node:https";
import { ENV } from "varlock/env";
import { loadCaBundle } from "./ca-bundle.ts";
import {
  getManifestProductDns,
  getManifestProductUri,
  getManifestRmMtlsBaseUri,
} from "./kraftwerk.ts";
import { logger } from "./logger.ts";

/**
 * Outbound mTLS to RM and to sibling products, using the client certificate
 * kw_product_init writes on first run. This is the caller side of the boundary
 * /rmapi guards: there we check who is calling us, here we prove who we are.
 *
 * node:https rather than fetch + undici.Agent: global fetch cannot be given a
 * client certificate without importing undici, which is not a dependency here.
 *
 * Everything is lazy because the cert does not exist until container init has
 * run, and this module is imported at boot.
 */

const TIMEOUT_MS = 30_000;

let agent: Agent | undefined;

/** Built once and reused: re-reading the key per request would be silly. */
const mtlsAgent = (): Agent => {
  if (!agent) {
    agent = new Agent({
      cert: readFileSync(ENV.TAK_CLIENT_CERT_PATH),
      key: readFileSync(ENV.TAK_CLIENT_KEY_PATH),
      ca: loadCaBundle(ENV.CA_PATH),
      keepAlive: true,
    });
  }
  return agent;
};

export class MtlsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MtlsError";
  }
}

const call = (
  url: string,
  method: "GET" | "POST",
  body?: string,
): Promise<{ status: number; text: string }> =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        agent: mtlsAgent(),
        headers: body
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) }
          : {},
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          text += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new MtlsError(`${method} ${url} timed out`)));
    if (body) req.write(body);
    req.end();
  });

/**
 * Ask RM to grant us interop with another product. RM verifies our CN against
 * its manifest and forwards to the target's /api/v1/interop/add, so the target
 * only ever has to trust RM for this. Idempotent on the receiving side, so it is
 * called on every boot rather than tracked.
 */
export const rmInteropAdd = async (targetProduct: string): Promise<void> => {
  const base = getManifestRmMtlsBaseUri();
  const certcn = getManifestProductDns();
  if (!base || !certcn) {
    throw new MtlsError("kraftwerk manifest has no rasenmaeher.mtls.base_uri or product.dns");
  }
  const url = new URL(`api/v1/product/interop/${targetProduct}`, base).toString();
  // CFSSL conventions: the shared ProductAddRequest carries the PEM with escaped newlines
  const x509cert = readFileSync(ENV.TAK_CLIENT_CERT_PATH, "utf8").replace(/\n/g, "\\n");
  const { status, text } = await call(url, "POST", JSON.stringify({ certcn, x509cert }));
  if (status !== 200) {
    throw new MtlsError(
      `interop/${targetProduct} returned ${status}: ${text.slice(0, 200)}`,
      status,
    );
  }
  logger.info({ targetProduct, certcn }, "interop granted by RM");
};

/** What a product hands a peer through /api/v1/interop/authz. */
export type ProductAuthz = {
  type: string;
  token?: string | null;
  username?: string | null;
  password?: string | null;
  ro_password?: string | null;
};

/**
 * Fetch credentials from a sibling product. `productHost` is that product's
 * mTLS-terminated host, e.g. "mtls.matrix.deployment.tld:4626".
 */
export const productAuthzGet = async (productHost: string): Promise<ProductAuthz> => {
  const { status, text } = await call(`https://${productHost}/api/v1/interop/authz`, "GET");
  if (status !== 200) {
    throw new MtlsError(`interop/authz on ${productHost} returned ${status}`, status);
  }
  return JSON.parse(text) as ProductAuthz;
};

/**
 * Host of a sibling product's mTLS API, derived from our own product URI: RM
 * gives every product the same port and the same `mtls.` prefix, so our own URI
 * is enough to address a sibling and there is nothing extra to configure.
 */
export const siblingProductHost = (productName: string): string | undefined => {
  const ourUri = getManifestProductUri();
  if (!ourUri) return undefined;
  try {
    const url = new URL(ourUri);
    const domain = url.hostname
      .replace(/^mtls\./, "")
      .split(".")
      .slice(1)
      .join(".");
    if (!domain) return undefined;
    return url.port ? `mtls.${productName}.${domain}:${url.port}` : `mtls.${productName}.${domain}`;
  } catch {
    return undefined;
  }
};
