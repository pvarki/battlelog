import type { Widget } from "../api.ts";
import { getWidget, mapChildWidgets, validateWidgetConfig } from "./registry.ts";

const shownOnMobile = (w: Pick<Widget, "type" | "config">) => {
  const descriptor = getWidget(w.type);
  if (!descriptor || descriptor.showOnMobile === false) return false;
  return (w.config as { showOnMobile?: unknown } | null)?.showOnMobile !== false;
};

/**
 * A container's children as standalone widgets in its slot — one child per
 * bottom-bar entry instead of e.g. a tab strip inside the switcher. An invalid
 * container config stays whole so its placeholder still shows. Child ids are
 * prefixed with the parent's: a duplicated container keeps its children's ids.
 */
const flattenChildren = (w: Widget): Widget[] => {
  const childWidgets = getWidget(w.type)?.childWidgets;
  if (!childWidgets) return [w];
  const validation = validateWidgetConfig(w.type, w.config);
  if (!validation.ok) return [w];
  return childWidgets(validation.value)
    .filter(shownOnMobile)
    .map((tab) => ({ ...tab, id: `${w.id}/${tab.id}`, layout: w.layout }));
};

/**
 * The widgets a phone shows, in reading order (top-to-bottom, left-to-right
 * of the desktop layout): the type must allow mobile, the instance must not
 * be excluded, and the type must be registered at all. Containers are
 * flattened into their children.
 */
export const mobileWidgets = (widgets: Widget[]): Widget[] =>
  widgets
    .filter(shownOnMobile)
    .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
    .flatMap(flattenChildren);

/**
 * Writes `config` to the widget with `id`, which on mobile may be a container's
 * child — a child's captured eventId must land in its parent's config.
 */
export const withWidgetConfig = (widgets: Widget[], id: string, config: unknown): Widget[] =>
  widgets.map((w) => {
    if (w.id === id) return { ...w, config };
    if (!id.startsWith(`${w.id}/`)) return w;
    const childId = id.slice(w.id.length + 1);
    const next = mapChildWidgets(w, (child) =>
      child.id === childId ? { ...child, config } : child,
    );
    return next === w.config ? w : { ...w, config: next };
  });
