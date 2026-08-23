import type { Widget } from "../api.ts";
import { getWidget } from "./registry.ts";

/**
 * The widgets a phone shows, in reading order (top-to-bottom, left-to-right
 * of the desktop layout): the type must allow mobile, the instance must not
 * be excluded, and the type must be registered at all.
 */
export const mobileWidgets = (widgets: Widget[]): Widget[] =>
  widgets
    .filter((w) => {
      const descriptor = getWidget(w.type);
      if (!descriptor || descriptor.showOnMobile === false) return false;
      return (w.config as { showOnMobile?: unknown } | null)?.showOnMobile !== false;
    })
    .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
