import { IconFolders } from "@tabler/icons-react";
import { lazy } from "react";
import { z } from "zod";
import type { WidgetDescriptor } from "../../dashboard/registry.ts";
import { baseWidgetConfig } from "../../dashboard/widget-base.ts";

export const TABS_TYPE = "tabs";

/**
 * A tab is one child widget, minus a layout — it fills the tab. The tab's
 * label is the child's own `title` (falling back to its type name), so there
 * is one name to edit, not two. The child's config is validated by the
 * registry when it renders, exactly like a top-level widget's.
 */
const tabSchema = z
  .object({
    id: z.string().min(1).max(64),
    type: z
      .string()
      .min(1)
      .max(64)
      .refine((type) => type !== TABS_TYPE, "Tabs cannot contain tabs"),
    config: z.any(),
  })
  .strict();

export const configSchema = z
  .object({
    ...baseWidgetConfig,
    tabs: z.array(tabSchema).max(8).default([]),
  })
  .strict();

export type TabsConfig = z.infer<typeof configSchema>;
export type Tab = TabsConfig["tabs"][number];

/**
 * A copy of a tabs widget's config whose children have fresh ids. Child ids key
 * template documents and mobile entries, so a duplicate must not reuse them.
 */
export const withFreshTabIds = (config: unknown): unknown => {
  const tabs = (config as { tabs?: unknown } | null)?.tabs;
  if (!Array.isArray(tabs)) return config;
  return {
    ...(config as Record<string, unknown>),
    tabs: tabs.map((tab) =>
      tab && typeof tab === "object" ? { ...tab, id: crypto.randomUUID() } : tab,
    ),
  };
};

const descriptor: WidgetDescriptor<TabsConfig> = {
  type: TABS_TYPE,
  Icon: IconFolders,
  name: "Tabs",
  description: "Several widgets in one slot, one tab each",
  configSchema,
  defaultConfig: { tabs: [] },
  defaultSize: { w: 16, h: 12 },
  minSize: { w: 8, h: 6 },
  childWidgets: (config) => config.tabs,
  View: lazy(() => import("./View.tsx")),
  ConfigForm: lazy(() => import("./Config.tsx")),
};

export default descriptor;
