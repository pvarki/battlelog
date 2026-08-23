import { useMediaQuery } from "@mantine/hooks";
import type { Widget } from "../api.ts";
import { getWidget } from "./registry.ts";

/**
 * One definition of "mobile" for the whole app: desktop layouts (the grid,
 * the management landing page, the results table) need ~1024px to work, so
 * everything under that gets the mobile treatment — phones and portrait
 * tablets alike. The height clause catches landscape phones. Mirrored in
 * global.css (CSS can't import this).
 */
export const MOBILE_QUERY = "(max-width: 1023px), (max-height: 479px)";

export const useIsMobile = () =>
  useMediaQuery(MOBILE_QUERY, false, { getInitialValueInEffect: false });

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
