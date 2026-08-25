import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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
