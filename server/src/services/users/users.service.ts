import { X509Certificate } from "node:crypto";
import { asc, eq, or, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { type UserRow, users } from "../../db/schema.ts";
import { parseDistinguishedName } from "../../lib/client-cert.ts";
import { logger } from "../../lib/logger.ts";

/**
 * Users as RASENMAEHER tells us about them. We keep them for one reason:
 * knowing who is an admin, which gates who may change what gets ingested.
 * RM is the source of truth, so every write here comes from an /rmapi hook.
 */

/** The shape RM posts to the user lifecycle hooks (libpvarki's UserCRUDRequest). */
export type RmUser = {
  uuid: string;
  callsign: string;
  x509cert: string;
};

/**
 * CN of the user's certificate, when we can read it. RM sends the PEM with
 * newlines escaped, CFSSL style. Returns undefined for anything unparseable —
 * the callsign is still a usable fallback, so a bad cert must not fail the hook.
 */
export const certCnFromPem = (x509cert: string): string | undefined => {
  const pem = x509cert.replace(/\\n/g, "\n").trim();
  if (!pem.startsWith("-----BEGIN CERTIFICATE-----")) return undefined;
  try {
    // subject is a newline-separated DN, which parseDistinguishedName handles
    return parseDistinguishedName(new X509Certificate(pem).subject.replace(/\n/g, ",")).CN;
  } catch (err) {
    logger.warn({ err }, "users: could not read CN from certificate");
    return undefined;
  }
};

/**
 * Record or refresh a user. Idempotent: RM replays hooks, and "already exists"
 * is not an error. Keyed on RM's uuid, which never changes for an account.
 */
export const upsertUser = async (user: RmUser): Promise<UserRow> => {
  const values = {
    uuid: user.uuid,
    callsign: user.callsign,
    certCn: certCnFromPem(user.x509cert) ?? null,
    revokedAt: null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({ target: users.uuid, set: values })
    .returning();
  if (!row) throw new Error("upsertUser: insert returned no row");
  return row;
};

/**
 * Mark a user's cert revoked. The row stays: events reference their author, and
 * losing that would rewrite history.
 */
export const revokeUser = async (uuid: string): Promise<void> => {
  await db
    .update(users)
    .set({ revokedAt: new Date(), isAdmin: false, updatedAt: new Date() })
    .where(eq(users.uuid, uuid));
};

export const setUserAdmin = async (uuid: string, isAdmin: boolean): Promise<void> => {
  await db.update(users).set({ isAdmin, updatedAt: new Date() }).where(eq(users.uuid, uuid));
};

/**
 * Look a caller up by the CN in their mTLS DN header.
 *
 * A callsign can be reused after its previous holder is revoked, so more than
 * one row can match. Live rows sort first: the person holding the certificate
 * now is the one whose admin status applies.
 */
export const findUserByCn = async (cn: string): Promise<UserRow | undefined> => {
  const [row] = await db
    .select()
    .from(users)
    .where(or(eq(users.certCn, cn), eq(users.callsign, cn)))
    .orderBy(sql`${users.revokedAt} IS NOT NULL`, asc(users.createdAt));
  return row;
};
