import type { DashboardResponse, EventResponse } from "../api.ts";
import { getWidget } from "./registry.ts";

/**
 * The export file is exactly the body `POST /dashboards` accepts, so import is
 * parse-and-post with no mapping step. Identity and history (id, version,
 * createdBy, timestamps) are the receiving system's to mint.
 */
export type DashboardExport = {
  name: string;
  description: string | null;
  isTemplate: boolean;
  widgets: DashboardResponse["widgets"];
  templateEvents?: DashboardResponse["templateEvents"];
};

export type WidgetEventPointer = {
  widgetId: string;
  widgetType: string;
  eventId: string;
};

export const TEMPLATE_TAG = "template";

/**
 * Widgets with their content pointer dropped. `eventId` is the one uniform
 * handle on a widget's event chain (note, todo, table, status, schedule all use
 * it), and `useEventDocument` mints a fresh one on first edit when it is absent
 * — so clearing it is what makes a copy its own document instead of a second
 * window onto the original's.
 */
export const forkWidgets = (widgets: DashboardResponse["widgets"]): DashboardResponse["widgets"] =>
  widgets.map((w) => {
    if (!w.config || typeof w.config !== "object") return w;
    const config = { ...(w.config as Record<string, unknown>) };
    if (!("eventId" in config)) return w;
    delete config.eventId;
    return { ...w, config };
  });

export const widgetEventPointers = (widgets: DashboardResponse["widgets"]): WidgetEventPointer[] =>
  widgets.flatMap((widget) => {
    if (!getWidget(widget.type)?.document) return [];
    if (!widget.config || typeof widget.config !== "object") return [];
    const { eventId } = widget.config as Record<string, unknown>;
    return typeof eventId === "string"
      ? [{ widgetId: widget.id, widgetType: widget.type, eventId }]
      : [];
  });

export const templateEventFor = (
  pointer: WidgetEventPointer,
  event: EventResponse,
): DashboardResponse["templateEvents"][number] => ({
  widgetId: pointer.widgetId,
  header: event.header,
  type: event.type ?? pointer.widgetType,
  tags: [...new Set([...(event.tags ?? []), TEMPLATE_TAG])],
  ...(event.data === null || event.data === undefined ? {} : { data: event.data }),
});

export const toExportJson = (d: DashboardResponse): string =>
  JSON.stringify(
    {
      name: d.name,
      description: d.description,
      isTemplate: d.isTemplate,
      // The import dialog promises content does not travel with the file; a
      // kept eventId would make that false for an import into this same
      // deployment, where the chain it names still exists.
      widgets: forkWidgets(d.widgets),
      ...(d.templateEvents.length ? { templateEvents: d.templateEvents } : {}),
    },
    null,
    2,
  );

export const exportFilename = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "dashboard"}.dashboard.json`;
};

export type ImportResult = { ok: true; value: DashboardExport } | { ok: false; error: string };

/**
 * Shape check only — enough to name what's wrong with a hand-edited or foreign
 * file. The server's createDashboardRequestSchema is the real validator; every
 * widget's own config is validated by the registry on render.
 */
export const parseDashboardImport = (text: string): ImportResult => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON" };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { ok: false, error: "Expected a single dashboard export object" };
  const d = raw as Partial<DashboardExport>;
  if (typeof d.name !== "string" || !d.name.trim())
    return { ok: false, error: "Missing a dashboard name" };
  if (!Array.isArray(d.widgets)) return { ok: false, error: "Missing a widgets list" };
  if (d.templateEvents !== undefined && !Array.isArray(d.templateEvents))
    return { ok: false, error: "Template events must be a list" };
  return {
    ok: true,
    value: {
      name: d.name.trim(),
      // Absent, blank and null all mean "no description" — normalise so the
      // list never has to distinguish an empty string from nothing at all.
      description:
        typeof d.description === "string" && d.description.trim() ? d.description.trim() : null,
      isTemplate: d.isTemplate === true,
      widgets: d.widgets,
      ...(d.templateEvents ? { templateEvents: d.templateEvents } : {}),
    },
  };
};
