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
