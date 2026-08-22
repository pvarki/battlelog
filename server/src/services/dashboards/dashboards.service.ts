import { and, desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "../../db/client.ts";
import type {
  DashboardInsert,
  DashboardRow,
  DashboardTemplateEvent,
  DashboardWidget,
} from "../../db/schema.ts";
import { dashboards, events } from "../../db/schema.ts";

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

const isUniqueViolation = (err: unknown, constraint: string): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: unknown }).code === "23505" &&
  (err as { constraint?: unknown }).constraint === constraint;

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

const withForkedTemplateEvents = (
  widgets: DashboardWidget[],
  templateEvents: DashboardTemplateEvent[],
): {
  widgets: DashboardWidget[];
  eventRows: (typeof events.$inferInsert)[];
} => {
  const documents = new Map(templateEvents.map((doc) => [doc.widgetId, doc]));
  const eventRows: (typeof events.$inferInsert)[] = [];
  const nextWidgets = widgets.map((widget) => {
    const document = documents.get(widget.id);
    if (!document) return widget;

    const id = uuidv7();
    eventRows.push({
      id,
      eventId: id,
      updateFor: null,
      createdBy: "",
      updatedBy: null,
      header: document.header,
      type: document.type,
      data: document.data ?? null,
      eventTime: null,
      tags: null,
      hcoeDomains: null,
      admiraltyReliability: null,
      admiraltyAccuracy: null,
      location: null,
      locationPoint: null,
      inputSource: null,
      sourceUri: null,
    });
    return {
      ...widget,
      config: {
        ...(typeof widget.config === "object" && widget.config !== null ? widget.config : {}),
        eventId: id,
      },
    };
  });
  return { widgets: nextWidgets, eventRows };
};

export const createDashboard = async (input: CreateDashboardInput): Promise<DashboardRow> => {
  try {
    return await db.transaction(async (tx) => {
      const templateEvents = input.templateEvents ?? [];
      const widgets = input.widgets ?? [];
      const forked = input.isTemplate
        ? { widgets, eventRows: [] }
        : withForkedTemplateEvents(widgets, templateEvents);
      const eventRows = forked.eventRows.map((row) => ({ ...row, createdBy: input.createdBy }));
      if (eventRows.length) await tx.insert(events).values(eventRows);

      const [row] = await tx
        .insert(dashboards)
        .values({
          ...input,
          widgets: forked.widgets,
          templateEvents: input.isTemplate ? templateEvents : [],
          id: uuidv7(),
          version: uuidv7(),
        })
        .returning();
      if (!row) throw new Error("createDashboard: insert returned no row");
      return row;
    });
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
