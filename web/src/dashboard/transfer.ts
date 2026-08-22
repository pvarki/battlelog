import type { DashboardResponse } from "../api.ts";

/**
 * The export file is exactly the body `POST /dashboards` accepts, so import is
 * parse-and-post with no mapping step. Identity and history (id, version,
 * createdBy, timestamps) are the receiving system's to mint.
 */
export type DashboardExport = {
  name: string;
  isTemplate: boolean;
  widgets: DashboardResponse["widgets"];
};

export const toExportJson = (d: DashboardResponse): string =>
  JSON.stringify({ name: d.name, isTemplate: d.isTemplate, widgets: d.widgets }, null, 2);

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
  return {
    ok: true,
    value: { name: d.name.trim(), isTemplate: d.isTemplate === true, widgets: d.widgets },
  };
};
