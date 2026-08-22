import "varlock/auto-load";
import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { ENV } from "varlock/env";
import { parseDistinguishedName } from "../../lib/client-cert.ts";
import { getManifestProductUri, getManifestRmCertCn } from "../../lib/kraftwerk.ts";
import { logger } from "../../lib/logger.ts";

/**
 * RM (Rasenmaeher) product-integration API — endpoints the deployment app
 * calls INTO Battlelog: product card/instructions for its UI and user-cert
 * lifecycle webhooks. Mounted under /rmapi when RM_API_ENABLED=true.
 * Contract mirrors the previous implementation (typescript-liveloki-app).
 */

export type RmCallerConfig = {
  enforce: boolean;
  header: string;
  expectedCn: string;
};

const defaultRmCallerConfig = (): RmCallerConfig => ({
  enforce: ENV.RM_MTLS_ENFORCE,
  header: ENV.RM_MTLS_HEADER,
  expectedCn: ENV.RM_EXPECTED_CERT_CN || getManifestRmCertCn() || "rasenmaeher",
});

/** Only the RM instance (by mTLS cert CN) may call the gated rmapi endpoints. */
export const requireRmCaller = (cfg?: RmCallerConfig) =>
  createMiddleware(async (c, next) => {
    const { enforce, header, expectedCn } = cfg ?? defaultRmCallerConfig();
    if (!enforce) return next();

    const rawDn = c.req.header(header);
    if (!rawDn) {
      logger.warn("Rejected RM API request due to missing mTLS DN header");
      return c.json({ success: false, error: "Missing mTLS client certificate header" }, 401);
    }
    const cn = parseDistinguishedName(rawDn).CN;
    if (!cn) {
      logger.warn("Rejected RM API request due to malformed mTLS DN header");
      return c.json({ success: false, error: "Invalid mTLS client certificate header" }, 401);
    }
    if (cn !== expectedCn) {
      logger.warn({ cn, expectedCn }, "Rejected RM API request from unexpected CN");
      return c.json({ success: false, error: "Unexpected mTLS client certificate CN" }, 403);
    }
    return next();
  });

const DOCS_URL = "https://github.com/pvarki/battlelog";

/** Product URL RM hands to clients — mTLS-terminated host from the kraftwerk manifest. */
const battlelogUrl = (): string => {
  const productUri = getManifestProductUri();
  if (!productUri) return `http://localhost:${ENV.PORT}`;
  try {
    const url = new URL(productUri);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol === "https:" && !url.hostname.startsWith("mtls.") && !isLocal) {
      url.hostname = `mtls.${url.hostname}`;
    }
    return url.toString();
  } catch {
    logger.warn({ productUri }, "Invalid product URI in kraftwerk manifest, using raw value");
    return productUri;
  }
};

const descriptionFor = (language: string) => {
  const byLang: Record<string, string> = {
    en: "Event management and tracking",
    fi: "Tapahtumien hallinta ja seuranta",
    sv: "Handelsehantering och sparning",
  };
  const lang = byLang[language] ? language : "en";
  return {
    shortname: "bl",
    title: "BattleLog",
    icon: null,
    description: byLang[lang],
    language: lang,
    component: { type: "link", ref: battlelogUrl() },
    docs: DOCS_URL,
  };
};

/** RM's v1 description model forbids extra keys, so drop the v2-only fields. */
const descriptionV1For = (language: string) => {
  const { shortname, title, icon, description, language: resolved } = descriptionFor(language);
  return { shortname, title, icon, description, language: resolved };
};

export const rmRoutes = new Hono();
const rmOnly = requireRmCaller();
const noOp = (c: Context) => c.json({ success: true });

rmRoutes.get("/api/v1/healthcheck", (c) =>
  c.json({ healthy: true, extra: "Battlelog RM API routes available" }),
);

// RM routes the card by which endpoint answers: the Deploy App home grid reads
// v2, the admin-tools list reads v2/admin. Serving only the user-facing pair
// puts BattleLog on the main grid instead of duplicating it under admin tools.
rmRoutes.get("/api/v1/description/:language", rmOnly, (c) =>
  c.json(descriptionV1For(c.req.param("language"))),
);
rmRoutes.get("/api/v2/description/:language", rmOnly, (c) =>
  c.json(descriptionFor(c.req.param("language"))),
);
rmRoutes.get("/api/v2/admin/description/:language", rmOnly, (c) =>
  c.json({ error: "Not found" }, 404),
);

rmRoutes.post("/api/v1/instructions/:language", rmOnly, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const description = descriptionFor(c.req.param("language"));
  return c.json({
    callsign: typeof body?.callsign === "string" ? body.callsign : "unknown",
    language: description.language,
    instructions: [
      { type: "paragraph", body: description.description },
      { type: "link", body: battlelogUrl() },
    ],
  });
});

rmRoutes.post("/api/v2/clients/data", rmOnly, (c) => c.json({ data: { url: battlelogUrl() } }));
rmRoutes.post("/api/v2/admin/clients/data", rmOnly, (c) =>
  c.json({ data: { url: battlelogUrl(), admin: true } }),
);

// User-cert lifecycle webhooks — acknowledged but not persisted (as before).
// Wire these to a users table when callsign resolution is needed.
rmRoutes.post("/api/v1/users/created", rmOnly, noOp);
rmRoutes.post("/api/v1/users/revoked", rmOnly, noOp);
rmRoutes.post("/api/v1/users/promoted", rmOnly, noOp);
rmRoutes.post("/api/v1/users/demoted", rmOnly, noOp);
rmRoutes.put("/api/v1/users/updated", rmOnly, noOp);
