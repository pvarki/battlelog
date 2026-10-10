import { useMediaQuery } from "@mantine/hooks";
import type { Widget } from "../api.ts";
import { TABS_TYPE, configSchema as tabsSchema } from "../widgets/tabs/widget.ts";
import { getWidget } from "./registry.ts";

/**
 * One definition of "mobile" for the whole app: desktop layouts (the grid,
 * the management landing page, the results table) need ~1024px to work, so
 * everything under that gets the mobile treatment — phones and portrait
 * tablets alike. The height clause catches landscape phones. `screen` keeps a
 * printout (an A4 page is ~800px wide) on the desktop layout. Mirrored in
 * global.css (CSS can't import this).
 */
export const MOBILE_QUERY = "screen and (max-width: 1023px), screen and (max-height: 479px)";

export const useIsMobile = () =>
  useMediaQuery(MOBILE_QUERY, false, { getInitialValueInEffect: false });

const shownOnMobile = (w: Pick<Widget, "type" | "config">) => {
  const descriptor = getWidget(w.type);
  if (!descriptor || descriptor.showOnMobile === false) return false;
  return (w.config as { showOnMobile?: unknown } | null)?.showOnMobile !== false;
};

/**
 * A tabs widget's children as standalone widgets in its slot — one tab per
 * bottom-bar entry instead of a tab strip inside the switcher. An invalid tabs
 * config stays whole so its placeholder still shows. Child ids are prefixed
 * with the parent's: a duplicated tabs widget keeps its children's ids.
 */
const flattenTabs = (w: Widget): Widget[] => {
  if (w.type !== TABS_TYPE) return [w];
  const parsed = tabsSchema.safeParse(w.config);
  if (!parsed.success) return [w];
  return parsed.data.tabs
    .filter(shownOnMobile)
    .map((tab) => ({ ...tab, id: `${w.id}/${tab.id}`, layout: w.layout }));
};

/**
 * The widgets a phone shows, in reading order (top-to-bottom, left-to-right
 * of the desktop layout): the type must allow mobile, the instance must not
 * be excluded, and the type must be registered at all. Tabs are flattened
 * into their children.
 */
export const mobileWidgets = (widgets: Widget[]): Widget[] =>
  widgets
    .filter(shownOnMobile)
    .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
    .flatMap(flattenTabs);

/**
 * Writes `config` to the widget with `id`, which on mobile may be a tab inside
 * a tabs widget — a child's captured eventId must land in its parent's config.
 */
export const withWidgetConfig = (widgets: Widget[], id: string, config: unknown): Widget[] =>
  widgets.map((w) => {
    if (w.id === id) return { ...w, config };
    const tabs = (w.config as { tabs?: unknown } | null)?.tabs;
    if (w.type !== TABS_TYPE || !Array.isArray(tabs) || !id.startsWith(`${w.id}/`)) return w;
    const childId = id.slice(w.id.length + 1);
    return {
      ...w,
      config: { ...w.config, tabs: tabs.map((t) => (t?.id === childId ? { ...t, config } : t)) },
    };
  });
