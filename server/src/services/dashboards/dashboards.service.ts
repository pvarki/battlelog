import { and, desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "../../db/client.ts";
import { isUniqueViolation } from "../../db/pg-error.ts";
import type { DashboardInsert, DashboardRow } from "../../db/schema.ts";
import { dashboards } from "../../db/schema.ts";

export type CreateDashboardInput = Omit<
  DashboardInsert,
  "id" | "version" | "createdAt" | "updatedAt"
>;
export type UpdateDashboardPatch = Partial<
  Pick<DashboardInsert, "name" | "description" | "widgets">
>;

/**
 * Thrown when a template name is already taken. Template names are the seeding
 * upsert key (a partial unique index), so this is a real constraint the caller
 * has to be able to explain — not an accident worth a 500.
 */
export class DuplicateTemplateNameError extends Error {
  constructor(name: string) {
    super(`A template named "${name}" already exists`);
    this.name = "DuplicateTemplateNameError";
  }
}

/** Thrown when the caller's version is stale — the dashboard was edited elsewhere. */
export class VersionConflictError extends Error {
  constructor(id: string) {
    super(`Dashboard ${id} was edited elsewhere`);
    this.name = "VersionConflictError";
  }
}

export const listDashboards = async (): Promise<DashboardRow[]> =>
  db.select().from(dashboards).orderBy(desc(dashboards.createdAt));

export const getDashboard = async (id: string): Promise<DashboardRow | null> => {
  const [row] = await db.select().from(dashboards).where(eq(dashboards.id, id));
  return row ?? null;
};

export const createDashboard = async (input: CreateDashboardInput): Promise<DashboardRow> => {
  try {
    const [row] = await db
      .insert(dashboards)
      .values({ ...input, id: uuidv7(), version: uuidv7() })
      .returning();
    if (!row) throw new Error("createDashboard: insert returned no row");
    return row;
  } catch (err) {
    if (isUniqueViolation(err, "dashboards_template_name_unique")) {
      throw new DuplicateTemplateNameError(input.name);
    }
    throw err;
  }
};

/**
 * Optimistic concurrency: the update only applies if `expectedVersion` still
 * matches. A miss means either the row is gone (null) or someone else saved
 * in between ({@link VersionConflictError}).
 */
export const updateDashboard = async (
  id: string,
  patch: UpdateDashboardPatch,
  updatedBy: string,
  expectedVersion: string,
): Promise<DashboardRow | null> => {
  const [row] = await db
    .update(dashboards)
    .set({ ...patch, updatedBy, updatedAt: new Date(), version: uuidv7() })
    .where(and(eq(dashboards.id, id), eq(dashboards.version, expectedVersion)))
    .returning();
  if (row) return row;
  const exists = await getDashboard(id);
  if (!exists) return null;
  throw new VersionConflictError(id);
};

export const deleteDashboard = async (id: string): Promise<boolean> => {
  const rows = await db
    .delete(dashboards)
    .where(eq(dashboards.id, id))
    .returning({ id: dashboards.id });
  return rows.length > 0;
};
