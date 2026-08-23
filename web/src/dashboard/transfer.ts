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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const intAtLeast = (value: unknown, min: number): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= min;

const validateWidgets = (widgets: unknown[]): string | null => {
  if (widgets.length > 50) return "Too many widgets — the maximum is 50";
  for (const [index, widget] of widgets.entries()) {
    const label = `Widget ${index + 1}`;
    if (!isRecord(widget)) return `${label} must be an object`;
    if (typeof widget.id !== "string" || !widget.id.trim())
      return `${label} is missing a string id`;
    if (widget.id.length > 64) return `${label} id is too long`;
    if (typeof widget.type !== "string" || !widget.type.trim())
      return `${label} is missing a string type`;
    if (widget.type.length > 64) return `${label} type is too long`;
    if (!isRecord(widget.layout)) return `${label} is missing a layout object`;
    const { x, y, w, h } = widget.layout;
    if (!intAtLeast(x, 0) || !intAtLeast(y, 0) || !intAtLeast(w, 1) || !intAtLeast(h, 1)) {
      return `${label} layout must contain integer x/y >= 0 and w/h >= 1`;
    }
  }
  return null;
};

const validateTemplateEvents = (events: unknown[]): string | null => {
  if (events.length > 50) return "Too many template events — the maximum is 50";
  for (const [index, event] of events.entries()) {
    const label = `Template event ${index + 1}`;
    if (!isRecord(event)) return `${label} must be an object`;
    if (typeof event.widgetId !== "string" || !event.widgetId.trim())
      return `${label} is missing a widgetId`;
    if (event.widgetId.length > 64) return `${label} widgetId is too long`;
    if (typeof event.header !== "string" || !event.header.trim())
      return `${label} is missing a header`;
    if (event.header.length > 100) return `${label} header is too long`;
    if (typeof event.type !== "string" || !event.type.trim()) return `${label} is missing a type`;
    if (event.type.length > 64) return `${label} type is too long`;
    if (
      event.tags !== undefined &&
      (!Array.isArray(event.tags) || event.tags.some((tag) => typeof tag !== "string" || !tag))
    ) {
      return `${label} tags must be a list of non-empty strings`;
    }
  }
  return null;
};

/**
 * Validates the dashboard JSON format produced by `toExportJson`. Widget config
 * is intentionally kept opaque here; each widget validates its own config
 * against the registry schema when it renders.
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
  if (d.name.trim().length > 100)
    return { ok: false, error: "Dashboard name is too long — the maximum is 100 characters" };
  if (d.description !== undefined && d.description !== null && typeof d.description !== "string")
    return { ok: false, error: "Description must be a string or null" };
  if (typeof d.description === "string" && d.description.length > 280)
    return { ok: false, error: "Description is too long — the maximum is 280 characters" };
  if (d.isTemplate !== undefined && typeof d.isTemplate !== "boolean")
    return { ok: false, error: "isTemplate must be true or false" };
  if (!Array.isArray(d.widgets)) return { ok: false, error: "Missing a widgets list" };
  const widgetError = validateWidgets(d.widgets);
  if (widgetError) return { ok: false, error: widgetError };
  if (d.templateEvents !== undefined && !Array.isArray(d.templateEvents))
    return { ok: false, error: "Template events must be a list" };
  if (d.templateEvents) {
    const templateEventError = validateTemplateEvents(d.templateEvents);
    if (templateEventError) return { ok: false, error: templateEventError };
  }
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
