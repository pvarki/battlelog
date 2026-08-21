import { z } from "@hono/zod-openapi";
import type { DashboardRow } from "../../db/schema.ts";

/** Every widget type the platform knows how to render. Extend here first. */
export const WIDGET_TYPES = ["clock"] as const;

export const widgetSchema = z
  .object({
    /** Client-generated, unique within the dashboard; doubles as the grid item key. */
    id: z.string().min(1).max(64),
    type: z.enum(WIDGET_TYPES),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  })
  .openapi("DashboardWidget");
export type Widget = z.infer<typeof widgetSchema>;

export const dashboardResponseSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    widgets: z.array(widgetSchema),
    createdBy: z.string(),
    updatedBy: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Dashboard");
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

export const createDashboardRequestSchema = z
  .object({
    name: z.string().min(1).max(100),
    widgets: z.array(widgetSchema).max(50).default([]),
  })
  .openapi("CreateDashboardRequest");

export const updateDashboardRequestSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    widgets: z.array(widgetSchema).max(50).optional(),
  })
  .openapi("UpdateDashboardRequest");

export const toApiDashboard = (row: DashboardRow): DashboardResponse => ({
  id: row.id,
  name: row.name,
  // Stored widgets were validated by widgetSchema on every write.
  widgets: row.widgets as Widget[],
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
