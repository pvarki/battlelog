import { z } from "zod";
import { api, dashboardsApi, type EventResponse } from "./api.ts";

/**
 * Alerts: a filter that raises its hand instead of narrowing a list.
 *
 * A rule lives in the widget that watches for it, next to the views that widget
 * shows, because that is where an operator already thinks about "what matters on
 * this board". Nothing about a rule is stored server-side and no alert row is
 * ever written: an alert is the pairing of a rule with an event, derived on
 * demand. That keeps the whole feature to one table we already have.
 *
 * ponytail: derived, so editing a rule rewrites history — yesterday's alerts are
 * whatever today's rules match. That is the right trade while rules are a
 * dashboard setting. If an alert ever has to be a matter of record ("this fired,
 * at this time, under this rule"), it needs a server-side evaluator writing its
 * own event, not a bigger client.
 */

export const SEVERITIES = ["info", "warn", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: "Info",
  warn: "Huomio",
  critical: "Kriittinen",
};

/** Mantine colour per severity, used for the badge, the flash and the toast. */
export const SEVERITY_COLOUR: Record<Severity, string> = {
  info: "blue",
  warn: "yellow",
  critical: "red",
};

/** The event type a dismissal is logged as. */
export const DISMISS_EVENT_TYPE = "alert-dismissed";

export const alertSchema = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(60),
    severity: z.enum(SEVERITIES).default("warn"),
    /** Only these event types raise it; empty = any type. */
    types: z.array(z.string().min(1)).optional(),
    /** Any of these tags; empty = any. */
    tags: z.array(z.string().min(1)).optional(),
    /** Header contains, case-insensitive. */
    search: z.string().max(200).default(""),
    /** Data field that must hold {@link dataValue}; empty = no data condition. */
    dataKey: z.string().max(200).default(""),
    dataValue: z.string().max(200).default(""),
    createdBy: z.string().max(200).default(""),
  })
  .strict();

export type Alert = z.infer<typeof alertSchema>;

/** Same coercion the events API applies, so a rule means one thing everywhere. */
const parseDataValue = (raw: string): string | number | boolean => {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return raw;
};

/**
 * Does this event raise this alert?
 *
 * A rule with nothing set matches everything, which is almost never wanted, so
 * {@link isBlankAlert} exists for the UI to say so rather than for this to
 * silently refuse.
 */
export const matchesAlert = (row: EventResponse, alert: Alert): boolean => {
  if (alert.types?.length && (row.type === null || !alert.types.includes(row.type))) return false;
  if (alert.tags?.length && !alert.tags.some((t) => row.tags?.includes(t))) return false;
  if (alert.search && !row.header.toLowerCase().includes(alert.search.toLowerCase())) return false;
  if (alert.createdBy && row.createdBy !== alert.createdBy) return false;
  if (alert.dataKey) {
    const data = row.data as Record<string, unknown> | null;
    if (!data || data[alert.dataKey] !== parseDataValue(alert.dataValue)) return false;
  }
  // A dismissal must never raise an alert, or acknowledging one spawns the next.
  return row.type !== DISMISS_EVENT_TYPE;
};

/** True when a rule constrains nothing, and so would fire on every event. */
export const isBlankAlert = (alert: Alert): boolean =>
  !alert.types?.length &&
  !alert.tags?.length &&
  !alert.search &&
  !alert.createdBy &&
  !alert.dataKey;

/** A rule's conditions in words, for the widget and the alert list. */
export const describeAlert = (alert: Alert): string => {
  const parts: string[] = [];
  if (alert.types?.length) parts.push(`tyyppi: ${alert.types.join(", ")}`);
  if (alert.tags?.length) parts.push(`tagi: ${alert.tags.join(", ")}`);
  if (alert.search) parts.push(`teksti: ${alert.search}`);
  if (alert.createdBy) parts.push(`lähettäjä: ${alert.createdBy}`);
  if (alert.dataKey) parts.push(`${alert.dataKey} = ${alert.dataValue}`);
  return parts.length ? parts.join(" · ") : "ei ehtoja — hälyttää kaikesta";
};

/** One event that raised one rule. */
export type RaisedAlert = {
  /** Stable across reloads: the same event and rule always give the same key. */
  key: string;
  alert: Alert;
  event: EventResponse;
  /** Where the rule is configured, for "which board is shouting". */
  source: string;
};

export const raisedKey = (alertId: string, eventId: string): string => `${alertId}:${eventId}`;

/**
 * Every alert rule configured on any dashboard.
 *
 * The Alerts widget shows alerts from all boards, not only its own, so the rules
 * have to be read from the dashboards rather than from the widget holding them.
 * Widgets travel inside the dashboard response, so this is one request.
 */
export const loadAlertRules = async (): Promise<{ alert: Alert; source: string }[]> => {
  const res = await dashboardsApi.dashboards.$get();
  if (!res.ok) return [];
  const dashboards = await res.json();
  const rules: { alert: Alert; source: string }[] = [];
  for (const dashboard of dashboards) {
    for (const widget of dashboard.widgets) {
      const raw = (widget.config as { alerts?: unknown } | null)?.alerts;
      if (!Array.isArray(raw)) continue;
      for (const one of raw) {
        const parsed = alertSchema.safeParse(one);
        // Configs persist mid-edit, so an unfinished rule is normal: skip it
        // rather than letting one bad rule hide every other board's alerts.
        if (parsed.success) rules.push({ alert: parsed.data, source: dashboard.name });
      }
    }
  }
  return rules;
};

/**
 * Log a dismissal.
 *
 * The acknowledgement is itself an event, so who cleared what is in the same log
 * as everything else rather than in a private flag on a row nobody can audit.
 */
export const dismissAlert = async (raised: RaisedAlert): Promise<boolean> => {
  const res = await api.events.$post({
    json: {
      header: `Kuitattu: ${raised.alert.label} — ${raised.event.header}`.slice(0, 200),
      type: DISMISS_EVENT_TYPE,
      tags: ["alert", raised.alert.severity],
      data: {
        alertId: raised.alert.id,
        alertLabel: raised.alert.label,
        severity: raised.alert.severity,
        eventId: raised.event.id,
        source: raised.source,
      },
    },
  });
  return res.status === 201;
};

/** The alert keys a set of dismissal events has cleared. */
export const dismissedKeys = (rows: readonly EventResponse[]): Set<string> => {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.type !== DISMISS_EVENT_TYPE) continue;
    const data = row.data as { alertId?: unknown; eventId?: unknown } | null;
    if (typeof data?.alertId === "string" && typeof data.eventId === "string") {
      keys.add(raisedKey(data.alertId, data.eventId));
    }
  }
  return keys;
};
