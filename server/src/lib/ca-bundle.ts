import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { logger } from "./logger.ts";

/**
 * The CA certificates to verify deployment peers against.
 *
 * A deployment has more than one CA: RASENMAEHER's own root and intermediate
 * sign client certificates, while the server certificates that nginx and TAK
 * present are signed by miniwerk's CA in a local deployment and by a public
 * issuer in production. Trusting only one of them fails the handshake, so the
 * whole directory is loaded — the same thing kw_product_init does.
 *
 * CRLs live in that directory too and are not certificates, hence the content
 * check rather than a filename pattern.
 */
export const loadCaBundle = (path: string): Buffer[] => {
  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch (err) {
    logger.warn({ err, path }, "CA path is not readable; peer verification will fail");
    return [];
  }
  if (!isDir) return [readFileSync(path)];

  const bundle: Buffer[] = [];
  for (const name of readdirSync(path).sort()) {
    if (!name.endsWith(".pem")) continue;
    const contents = readFileSync(join(path, name));
    if (contents.includes("BEGIN CERTIFICATE")) bundle.push(contents);
  }
  if (!bundle.length) logger.warn({ path }, "no CA certificates found");
  return bundle;
};

/**
 * Everything we are willing to verify a server certificate against.
 *
 * Node's `ca` option REPLACES the default trust store rather than adding to it,
 * so passing only the deployment's CAs meant blapi could verify nothing that a
 * public authority had issued. That is not a corner case in this composition:
 * TAK's 8089 listener presents /le_certs/rasenmaeher/fullchain.pem, which in a
 * real deployment is a Let's Encrypt certificate, and nginx serves the mTLS
 * endpoints from the same file. In production every one of those handshakes
 * failed with UNABLE_TO_GET_ISSUER_CERT_LOCALLY while passing locally, where
 * those certificates are signed by miniwerk's CA and /ca_public carries it.
 *
 * So: Node's built-in roots for the public side, plus /ca_public for the
 * deployment's own. Same union kw_product_init builds (SystemCertPool plus
 * --capath), for the same reason.
 *
 * This does widen what we trust for outbound TLS to any public authority. That
 * is unavoidable while the peers we connect to hold publicly issued
 * certificates, and it is the trust model of any ordinary HTTPS client; the
 * hostnames are fixed by config, not chosen by a caller.
 */
export const trustBundle = (path: string): (string | Buffer)[] => [
  ...rootCertificates,
  ...loadCaBundle(path),
];
