import type { ComponentType, LazyExoticComponent } from "react";
import type { z } from "zod";

export interface WidgetViewProps<TConfig> {
  config: TConfig;
  instanceId: string;
  editMode: boolean;
  dashboardIsTemplate?: boolean;
  updateConfig: (next: TConfig) => void;
  /**
   * Opens this widget's settings drawer. A misconfigured widget is the one
   * place a View must be able to send the user somewhere — telling them to
   * "configure it in settings" without a way there is a dead end.
   */
  onConfigure: () => void;
}

export interface WidgetConfigProps<TConfig> {
  config: TConfig;
  onChange: (next: TConfig) => void;
}

export interface WidgetDocumentDescriptor<TConfig, TDoc> {
  /** Event `type` used when the first save creates the event. */
  eventType: string;
  /** Empty document before an event exists or when loading a missing event. */
  empty: TDoc;
  /** Extract the document from an event's jsonb `data`. */
  parse: (data: unknown) => TDoc;
  /** Event header shown in the log. */
  headerFor: (config: TConfig, doc: TDoc) => string;
  debounceMs?: number;
}

/**
 * The widget contract. One folder per widget under src/widgets/<type>/ with a
 * `widget.ts` default-exporting a descriptor — the glob below discovers it.
 * `type` is the stable id stored in the DB: never rename it.
 * View (and ConfigForm) are React.lazy, so widget code stays out of the
 * initial bundle and only loads when an instance renders.
 */
export interface WidgetDescriptor<TConfig = unknown> {
  type: string;
  name: string;
  description?: string;
  /** Icon for the mobile switcher's bottom nav. */
  Icon?: ComponentType<{ size?: number | string; stroke?: number | string }>;
  /**
   * Whether this widget type is usable on a phone at all. Defaults to true;
   * types that fundamentally need a desktop (pointer, keyboard, width) set
   * false and never appear in the mobile switcher.
   */
  showOnMobile?: boolean;
  /** Input typed unknown so schemas may apply defaults (input ≠ output). */
  configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
  defaultConfig: TConfig;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  /**
   * Present when the widget owns a versioned event document in addition to its
   * config. The config still stores `eventId`; this is the explicit registry
   * contract that tells shared code how to load/save that document.
   */
  document?: WidgetDocumentDescriptor<TConfig, any>;
  View: LazyExoticComponent<ComponentType<WidgetViewProps<TConfig>>>;
  ConfigForm?: LazyExoticComponent<ComponentType<WidgetConfigProps<TConfig>>>;
}

// `any` for descriptor variance: View's config param makes WidgetDescriptor<T>
// not assignable to WidgetDescriptor<unknown>.
const modules = import.meta.glob<{ default: WidgetDescriptor<any> }>("../widgets/*/widget.ts", {
  eager: true,
});

export const registry: ReadonlyMap<string, WidgetDescriptor> = new Map(
  Object.values(modules).map((m) => [m.default.type, m.default]),
);

export const getWidget = (type: string): WidgetDescriptor | undefined => registry.get(type);

export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "unknown-type" | "invalid-config"; details?: string };

export const validateWidgetConfig = (type: string, config: unknown): ValidationResult => {
  const descriptor = registry.get(type);
  if (!descriptor) return { ok: false, reason: "unknown-type" };
  const result = descriptor.configSchema.safeParse(config ?? {});
  if (!result.success) {
    return {
      ok: false,
      reason: "invalid-config",
      details: result.error.issues.map((i) => i.message).join("; "),
    };
  }
  return { ok: true, value: result.data };
};
