import { z } from "@hono/zod-openapi";
import type { DashboardRow, DashboardTemplateEvent } from "../../db/schema.ts";

const widgetLayoutSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

/**
 * Structure-only validation: `type` and `config` belong to the web app's
 * widget registry, which validates config against the widget's own schema on
 * read. Unknown types render as a placeholder there instead of failing here.
 */
export const widgetSchema = z
  .object({
    /** Client-generated, unique within the dashboard; doubles as the grid item key. */
    id: z.string().min(1).max(64),
    type: z.string().min(1).max(64),
    // z.any (not z.unknown): unknown fails Hono's JSONValue constraint and
    // collapses typed responses to never.
    config: z.any(),
    layout: widgetLayoutSchema,
  })
  .openapi("DashboardWidget");
export type Widget = z.infer<typeof widgetSchema>;

const templateEventSchema = z
  .object({
    widgetId: z.string().min(1).max(64),
    header: z.string().min(1).max(100),
    type: z.string().min(1).max(64),
    tags: z.array(z.string().min(1)).optional(),
    data: z.any().optional(),
  })
  .openapi("DashboardTemplateEvent");

export const dashboardResponseSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    isTemplate: z.boolean(),
    widgets: z.array(widgetSchema),
    templateEvents: z.array(templateEventSchema),
    version: z.string(),
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
    description: z.string().max(280).nullish(),
    isTemplate: z.boolean().default(false),
    widgets: z.array(widgetSchema).max(50).default([]),
    templateEvents: z.array(templateEventSchema).max(50).default([]),
  })
  .openapi("CreateDashboardRequest");

export const updateDashboardRequestSchema = z
  .object({
    /** Version the client last saw; mismatch → 409 (edited elsewhere). */
    version: z.string().min(1),
    name: z.string().min(1).max(100).optional(),
    /** `null` clears it — the list has to be able to go back to just a name. */
    description: z.string().max(280).nullish(),
    widgets: z.array(widgetSchema).max(50).optional(),
    templateEvents: z.array(templateEventSchema).max(50).optional(),
  })
  .openapi("UpdateDashboardRequest");

export const toApiDashboard = (row: DashboardRow): DashboardResponse => ({
  id: row.id,
  name: row.name,
  description: row.description,
  isTemplate: row.isTemplate,
  // Stored widgets were validated by widgetSchema on every write.
  widgets: row.widgets as Widget[],
  templateEvents: row.templateEvents as DashboardTemplateEvent[],
  version: row.version,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
