import "varlock/auto-load";
import { readFileSync } from "node:fs";
import { Agent, request } from "node:https";
import { ENV } from "varlock/env";
import { trustBundle } from "./ca-bundle.ts";
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
      ca: trustBundle(ENV.CA_PATH),
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
        // A response that fails after its headers emits here and nowhere the
        // request can see. Without this the promise never settles, and since
        // the TAK stream awaits rmInteropAdd before every reconnect, one such
        // failure would stop the stream reconnecting for the life of the
        // process — while its status still read "connecting".
        res.on("error", reject);
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
  // A 200 here does NOT mean we are registered. RM answers 200 with
  // success:false when its own forward to the target product failed, so
  // treating the status code as the answer logged "interop granted" and then
  // asked the product for credentials it had never been told to issue — a 403
  // two milliseconds later, and three unrelated-looking symptoms in the UI.
  // Read what RM actually said.
  let granted = false;
  let detail = "";
  try {
    const body = JSON.parse(text) as { success?: unknown; error?: unknown; extra?: unknown };
    granted = body.success === true;
    detail = [body.error, body.extra].filter((v) => typeof v === "string").join(" ");
  } catch {
    throw new MtlsError(
      `interop/${targetProduct} returned unparseable body: ${text.slice(0, 200)}`,
    );
  }
  if (!granted) {
    // RM's own words: usually that the forward to the product 404'd or timed
    // out, which is a deployment fault rather than anything we can retry away.
    throw new MtlsError(
      `RM refused interop with ${targetProduct}: ${detail || text.slice(0, 200)}`,
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
