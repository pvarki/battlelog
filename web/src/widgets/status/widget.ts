import { IconGauge } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

/** Fixed palette: token-friendly Mantine colors that stay legible on dark. */
export const STATUS_COLORS = ["gray", "blue", "green", "yellow", "orange", "red"] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

const optionSchema = z.object({
  value: z.string().min(1).max(40),
  color: z.enum(STATUS_COLORS).default("gray"),
  /** Shown as a tooltip when hovering the chip while this option is selected. */
  description: z.string().max(300).optional(),
});
export type StatusOption = z.infer<typeof optionSchema>;

const statusRowSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(60),
  /** Shown as a tooltip on longer hover over the row. */
  description: z.string().max(300).optional(),
  /** "choice": one of the configured options (a boolean is a 2-option choice). "count": a number with −/+. */
  kind: z.enum(["choice", "count"]).default("choice"),
  options: z.array(optionSchema).max(12).default([]),
});
export type StatusRow = z.infer<typeof statusRowSchema>;

const configSchema = z
  .object({
    ...baseWidgetConfig,
    statuses: z.array(statusRowSchema).max(30).default([]),
    /** Current values live in the event log as a type:"status" event chain. */
    eventId: z.string().uuid().optional(),
  })
  .strict();

export type StatusConfig = z.infer<typeof configSchema>;

/** Current value per status row id: option value (choice) or number (count). */
export type StatusValues = { values: Record<string, string | number> };

const descriptor: WidgetDescriptor<StatusConfig> = {
  type: "status",
  Icon: IconGauge,
  name: "Status board",
  description: "Unit/task statuses — colored state chips and counters",
  configSchema,
  defaultConfig: { statuses: [] },
  defaultSize: { w: 8, h: 8 },
  minSize: { w: 5, h: 3 },
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;
