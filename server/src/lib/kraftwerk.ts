import { existsSync, readFileSync } from "node:fs";
import { logger } from "./logger.ts";

/** Deployment manifest dropped into the container by the RM/kraftwerk provisioning. */
const KRAFTWERK_FILE_PATH = "/pvarki/kraftwerk-init.json";

let warnedMissing = false;

const readManifest = (): unknown => {
  if (!existsSync(KRAFTWERK_FILE_PATH)) {
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn({ path: KRAFTWERK_FILE_PATH }, "kraftwerk manifest missing; using fallbacks");
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(KRAFTWERK_FILE_PATH, "utf8"));
  } catch (err) {
    logger.error({ err }, "Error reading kraftwerk manifest");
    return null;
  }
};

const manifestString = (pick: (m: Record<string, unknown>) => unknown): string | undefined => {
  const manifest = readManifest();
  if (!manifest || typeof manifest !== "object") return undefined;
  const value = pick(manifest as Record<string, unknown>);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const getManifestProductUri = () =>
  manifestString((m) => (m.product as Record<string, unknown> | undefined)?.uri);

export const getManifestRmCertCn = () =>
  manifestString((m) => (m.rasenmaeher as Record<string, unknown> | undefined)?.certcn);

/** Base URI of RM's mTLS-terminated API, e.g. "https://mtls.deployment.tld:4626/". */
export const getManifestRmMtlsBaseUri = () =>
  manifestString(
    (m) =>
      (
        (m.rasenmaeher as Record<string, unknown> | undefined)?.mtls as
          | Record<string, unknown>
          | undefined
      )?.base_uri,
  );

/** Our own product DNS name, e.g. "bl.deployment.tld". This is our client cert's CN. */
export const getManifestProductDns = () =>
  manifestString((m) => (m.product as Record<string, unknown> | undefined)?.dns);

/**
 * Deployment name — the first label of the deployment domain. Matrix aliases are
 * built from it (`#<deployment>-space:<domain>`), so it is how we find the Space
 * without matrixrmapi having to tell us.
 */
export const getManifestDeployment = () => manifestString((m) => m.deployment);
