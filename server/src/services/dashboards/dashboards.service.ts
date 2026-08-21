import { desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "../../db/client.ts";
import type { DashboardInsert, DashboardRow } from "../../db/schema.ts";
import { dashboards } from "../../db/schema.ts";

export type CreateDashboardInput = Omit<DashboardInsert, "id" | "createdAt" | "updatedAt">;
export type UpdateDashboardPatch = Partial<Pick<DashboardInsert, "name" | "widgets">>;

export const listDashboards = async (): Promise<DashboardRow[]> =>
  db.select().from(dashboards).orderBy(desc(dashboards.createdAt));

export const getDashboard = async (id: string): Promise<DashboardRow | null> => {
  const [row] = await db.select().from(dashboards).where(eq(dashboards.id, id));
  return row ?? null;
};

export const createDashboard = async (input: CreateDashboardInput): Promise<DashboardRow> => {
  const [row] = await db
    .insert(dashboards)
    .values({ ...input, id: uuidv7() })
    .returning();
  if (!row) throw new Error("createDashboard: insert returned no row");
  return row;
};

export const updateDashboard = async (
  id: string,
  patch: UpdateDashboardPatch,
  updatedBy: string,
): Promise<DashboardRow | null> => {
  const [row] = await db
    .update(dashboards)
    .set({ ...patch, updatedBy, updatedAt: new Date() })
    .where(eq(dashboards.id, id))
    .returning();
  return row ?? null;
};

export const deleteDashboard = async (id: string): Promise<boolean> => {
  const rows = await db
    .delete(dashboards)
    .where(eq(dashboards.id, id))
    .returning({ id: dashboards.id });
  return rows.length > 0;
};
