import type { Position, TakItem } from "../cot.ts";
import { type Bounds, distance } from "../geo.ts";
import { anchorOf, extentOf, hasPosition, type ItemStatus, labelOf, statusOf } from "../items.ts";
import { groupOf } from "../overlays.ts";

export type Affiliation = "friendly" | "hostile" | "neutral" | "unknown";
export type ItemKind = "people" | "markers" | "shapes" | "routes";
export type ItemSort = "name" | "newest" | "distance";

export type ItemFilters = {
  inView: boolean;
  statuses: ItemStatus[];
  affiliations: Affiliation[];
  kinds: ItemKind[];
  /** Minutes; null for any age. */
  updatedWithin: number | null;
  /** `feedSource(name)` per Data Sync feed, and `PLAN_SOURCE` for the active plan's drafts. */
  sources: string[];
};

export const PLAN_SOURCE = "plan";
/** Namespaced, so a feed named "plan" isn't taken for the drafts. */
export const feedSource = (name: string) => `feed:${name}`;

export const NO_FILTERS: ItemFilters = {
  inView: false,
  statuses: [],
  affiliations: [],
  kinds: [],
  updatedWithin: null,
  sources: [],
};

/** How many filters narrow the list, for the Filters button. */
export const activeFilters = (f: ItemFilters): number =>
  [
    f.inView,
    f.statuses.length,
    f.affiliations.length,
    f.kinds.length,
    f.updatedWithin,
    f.sources.length,
  ].filter(Boolean).length;

/** Team members are friendly; spot map markers and non-markers have no affiliation. */
export const affiliationOf = (item: TakItem): Affiliation | undefined => {
  const [top, sub] = groupOf(item);
  if (top !== "markers") return undefined;
  if (sub === "team") return "friendly";
  return sub === "friendly" || sub === "hostile" || sub === "neutral" || sub === "unknown"
    ? sub
    : undefined;
};

export const kindOf = (item: TakItem): ItemKind => {
  if (item.team) return "people";
  const [top, sub] = groupOf(item);
  if (top === "shapes") return "shapes";
  if (top === "navigation" && sub === "routes") return "routes";
  return "markers";
};

// A view panned across the antimeridian has longitudes past ±180; so can a shape.
const overlaps = ([[west, south], [east, north]]: [Position, Position], view: Bounds) =>
  south <= view.north &&
  north >= view.south &&
  (view.east - view.west >= 360 ||
    [-360, 0, 360].some((shift) => west + shift <= view.east && east + shift >= view.west));

export const inBounds = (item: TakItem, view: Bounds): boolean => {
  if (!hasPosition(item)) return false;
  const anchor = anchorOf(item);
  return overlaps(extentOf(item) ?? [anchor, anchor], view);
};

export type FilterContext = {
  now: number;
  /** The map's visible area; unknown before the map is up. */
  view: Bounds | undefined;
  /** Item uids per Data Sync feed. */
  feeds: ReadonlyMap<string, ReadonlySet<string>>;
};

const fromSource = (item: TakItem, sources: string[], feeds: FilterContext["feeds"]) =>
  sources.some((s) =>
    s === PLAN_SOURCE
      ? !!item.draft
      : [...feeds].some(([name, uids]) => feedSource(name) === s && uids.has(item.uid)),
  );

export const matchesFilters = (item: TakItem, f: ItemFilters, ctx: FilterContext): boolean => {
  if (f.inView && ctx.view && !inBounds(item, ctx.view)) return false;
  if (f.statuses.length && !f.statuses.includes(statusOf(item, ctx.now))) return false;
  if (f.affiliations.length) {
    const affiliation = affiliationOf(item);
    if (!affiliation || !f.affiliations.includes(affiliation)) return false;
  }
  if (f.kinds.length && !f.kinds.includes(kindOf(item))) return false;
  if (f.updatedWithin !== null && item.time < ctx.now - f.updatedWithin * 60_000) return false;
  if (f.sources.length && !fromSource(item, f.sources, ctx.feeds)) return false;
  return true;
};

const collator = new Intl.Collator(undefined, { numeric: true });
export const byName = (a: TakItem, b: TakItem) =>
  collator.compare(a.team ?? "", b.team ?? "") || collator.compare(labelOf(a), labelOf(b));

/** Newest first, or nearest first from `from` with unplaced items last. */
export const sortFlat = (items: TakItem[], sort: Exclude<ItemSort, "name">, from?: Position) => {
  if (sort === "newest") return items.toSorted((a, b) => b.time - a.time);
  if (!from) return items.toSorted(byName);
  const metres = new Map(
    items.map((i) => [i.uid, hasPosition(i) ? distance(from, anchorOf(i)) : Infinity]),
  );
  return items.toSorted(
    (a, b) => (metres.get(a.uid) ?? Infinity) - (metres.get(b.uid) ?? Infinity) || byName(a, b),
  );
};
