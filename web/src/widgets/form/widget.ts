import { lazy } from "react";
import { z } from "zod";
import type { CREDIBILITY, RELIABILITY } from "../../admiralty.ts";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";

/** Built-in event columns the form can expose, with their input labels. */
export const EVENT_FIELDS = {
  header: "Header",
  eventTime: "Event time",
  tags: "Tags",
  hcoeDomains: "HCOE domains",
  admiraltyReliability: "Reliability (A–F)",
  admiraltyAccuracy: "Credibility (1–6)",
  location: "Location",
  locationPoint: "Coordinates",
  sourceUri: "Source URI",
} as const;
export type EventFieldName = keyof typeof EVENT_FIELDS;
const eventFieldNames = Object.keys(EVENT_FIELDS) as [EventFieldName, ...EventFieldName[]];

const idSchema = z.string().min(1).max(64);

const eventFieldSchema = z.object({
  id: idSchema,
  kind: z.literal("event"),
  field: z.enum(eventFieldNames),
  required: z.boolean().optional(),
});

// Empty strings are allowed in label/key/value/reportType: the config editor
// stores every keystroke, and a config that fails the schema resets the
// settings form to defaultConfig. buildEvent skips/falls back on empties.
const dataFieldSchema = z.object({
  id: idSchema,
  kind: z.literal("data"),
  label: z.string().max(60),
  input: z.enum(["text", "textarea", "number", "select", "checkbox"]),
  /** Choices for input:"select". */
  options: z.array(z.string().min(1).max(60)).max(24).default([]),
  required: z.boolean().optional(),
});

/** Hidden value submitted with every event: an extra tag, or a data entry under `key`. */
const fixedFieldSchema = z.object({
  id: idSchema,
  kind: z.literal("fixed"),
  target: z.enum(["tags", "data"]),
  key: z.string().max(60).optional(),
  value: z.string().max(200),
});

const fieldSchema = z.discriminatedUnion("kind", [
  eventFieldSchema,
  dataFieldSchema,
  fixedFieldSchema,
]);
export type FormField = z.infer<typeof fieldSchema>;

const configSchema = z
  .object({
    /** Shown bold in the widget header (rendered by the wrapper). */
    title: z.string().max(100).optional(),
    /**
     * Submitted as type "form-<reportType>": the prefix keeps form events out
     * of the widget-owned chains (note/status/todo) other widgets follow.
     */
    reportType: z.string().max(40).default("report"),
    submitLabel: z.string().max(40).optional(),
    fields: z.array(fieldSchema).max(30).default([]),
  })
  .strict();

export type FormConfig = z.infer<typeof configSchema>;

/** Field values entered in the view, keyed by field id. */
export type FormValues = Record<string, unknown>;

export type FormEventPayload = {
  header: string;
  type: string;
  eventTime?: string;
  tags?: string[];
  hcoeDomains?: string[];
  admiraltyReliability?: (typeof RELIABILITY)[number];
  admiraltyAccuracy?: (typeof CREDIBILITY)[number];
  location?: string;
  locationPoint?: { lat: number; lng: number };
  sourceUri?: string;
  data?: Record<string, unknown>;
};

/** Data-blob key for a custom field: its label slugified. Colliding labels: last one wins. */
export const slugify = (label: string): string =>
  label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "field";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const point = (v: unknown): { lat: number; lng: number } | undefined => {
  const p = v as { lat?: unknown; lng?: unknown } | undefined | null;
  return p && typeof p.lat === "number" && typeof p.lng === "number"
    ? { lat: p.lat, lng: p.lng }
    : undefined;
};

/** Assemble the event to POST from the configured fields and entered values. */
export const buildEvent = (config: FormConfig, values: FormValues): FormEventPayload => {
  const reportType = config.reportType.trim() || "report";
  const payload: FormEventPayload = { header: "", type: `form-${reportType}` };
  const data: Record<string, unknown> = {};
  const tags: string[] = [];

  for (const f of config.fields) {
    if (f.kind === "fixed") {
      if (!f.value) continue;
      if (f.target === "tags") tags.push(f.value);
      else if (f.key) data[f.key] = f.value;
      continue;
    }
    const v = values[f.id];
    if (f.kind === "data") {
      if (v !== undefined && v !== null && v !== "") data[slugify(f.label)] = v;
      continue;
    }
    switch (f.field) {
      case "header":
        payload.header = str(v) ?? "";
        break;
      case "eventTime":
        if (typeof v === "string" && v) payload.eventTime = new Date(v).toISOString();
        break;
      case "tags":
        if (Array.isArray(v)) tags.push(...(v as string[]));
        break;
      case "hcoeDomains":
        if (Array.isArray(v) && v.length) payload.hcoeDomains = v as string[];
        break;
      case "admiraltyReliability":
        payload.admiraltyReliability = str(v) as FormEventPayload["admiraltyReliability"];
        break;
      case "admiraltyAccuracy":
        payload.admiraltyAccuracy = str(v) as FormEventPayload["admiraltyAccuracy"];
        break;
      case "location":
        payload.location = str(v);
        break;
      case "locationPoint":
        payload.locationPoint = point(v);
        break;
      case "sourceUri":
        payload.sourceUri = str(v);
        break;
    }
  }

  if (tags.length) payload.tags = [...new Set(tags)];
  if (Object.keys(data).length) payload.data = data;
  if (!payload.header) payload.header = (config.title ?? reportType).slice(0, 80);
  else payload.header = payload.header.slice(0, 80);
  return payload;
};

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);

/** Required fields the user hasn't filled in (id for marking, label for the summary). */
export const missingRequired = (
  config: FormConfig,
  values: FormValues,
): { id: string; label: string }[] => {
  const missing: { id: string; label: string }[] = [];
  for (const f of config.fields) {
    if (f.kind === "fixed" || !f.required) continue;
    const v = values[f.id];
    const empty =
      f.kind === "event" && f.field === "locationPoint" ? point(v) === undefined : isEmpty(v);
    if (empty)
      missing.push({ id: f.id, label: f.kind === "data" ? f.label : EVENT_FIELDS[f.field] });
  }
  return missing;
};

const descriptor: WidgetDescriptor<FormConfig> = {
  type: "form",
  name: "Form",
  description: "Post events to the feed from configurable fields",
  configSchema,
  defaultConfig: { reportType: "report", fields: [] },
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 5, h: 4 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;
