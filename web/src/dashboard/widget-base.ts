import { z } from "zod";

/**
 * In its own module (not registry.ts) on purpose: widget.ts files import this
 * VALUE, and registry.ts eagerly imports every widget.ts — through registry
 * that would be an import cycle that leaves descriptors undefined.
 */

/**
 * Fields every widget config schema must carry — spread this into the
 * `z.object({...})` of each widget's schema. The wrapper renders `title`;
 * the settings drawer writes `showOnMobile` into *any* widget's config, so a
 * schema missing it would brick that widget's config the moment the toggle
 * is flipped (`.strict()` rejects unknown keys).
 */
export const baseWidgetConfig = {
  /** Shown bold in the widget header (rendered by the wrapper). */
  title: z.string().max(100).optional(),
  /** Per-instance mobile visibility; default shown. */
  showOnMobile: z.boolean().optional(),
};

/** The user-given title from any widget's config, if it has one. */
export const configTitle = (config: unknown): string | undefined => {
  const title = (config as { title?: unknown } | null | undefined)?.title;
  return typeof title === "string" && title.trim() ? title : undefined;
};
