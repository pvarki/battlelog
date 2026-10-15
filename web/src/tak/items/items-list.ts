import type { Position, TakItem } from "../cot.ts";
import { describeType, labelOf } from "../items.ts";
import { groupOf, groupTree, isHidden, type Group as OverlayGroup } from "../overlays.ts";
import { byName, type ItemSort, sortFlat } from "./item-filters.ts";

// Groups holding more items than this start collapsed: thousands of rows bury the handful that matter.
export const BIG_GROUP = 300;

export const matchesQuery = (item: TakItem, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [labelOf(item), item.team, describeType(item), item.uid].some((s) =>
    s?.toLowerCase().includes(q),
  );
};

export type Row = { key: string; depth: number; dimmed: boolean } & (
  | { kind: "group"; group: OverlayGroup; open: boolean; ownHidden: boolean }
  | { kind: "item"; item: TakItem }
);

/** Open while searching; otherwise as the user left it, or by the BIG_GROUP rule. */
export const isGroupOpen = (
  group: OverlayGroup,
  opened: Record<string, boolean>,
  searching: boolean,
) => searching || (opened[group.key] ?? group.items.length <= BIG_GROUP);

/** The tree as the rows on screen, so only those in view are rendered. */
const flatten = (
  groups: OverlayGroup[],
  isOpen: (group: OverlayGroup) => boolean,
  hidden: ReadonlySet<string>,
  depth = 0,
  parentHidden = false,
): Row[] =>
  groups.flatMap((group) => {
    const ownHidden = hidden.has(group.key);
    const open = isOpen(group);
    const dimmed = ownHidden || parentHidden;
    const header: Row = { kind: "group", key: group.key, group, open, ownHidden, depth, dimmed };
    if (!open) return [header];
    return [
      header,
      ...flatten(group.children, isOpen, hidden, depth + 1, dimmed),
      ...group.items
        .sort(byName)
        .map((item): Row => ({ kind: "item", key: item.uid, item, depth: depth + 1, dimmed })),
    ];
  });

/** The overlay-group tree when sorted by name, else one flat sorted list; hidden groups' items are dimmed. */
export const listRows = (
  items: TakItem[],
  {
    sort,
    from,
    hidden,
    isOpen,
  }: {
    sort: ItemSort;
    from: Position | undefined;
    hidden: ReadonlySet<string>;
    isOpen: (group: OverlayGroup) => boolean;
  },
): Row[] =>
  sort === "name"
    ? flatten(groupTree(items), isOpen, hidden)
    : sortFlat(items, sort, from).map((item) => ({
        kind: "item",
        key: item.uid,
        item,
        depth: 0,
        dimmed: isHidden(groupOf(item), hidden),
      }));

export const groupKeys = (groups: OverlayGroup[]): string[] =>
  groups.flatMap((g) => [g.key, ...groupKeys(g.children)]);

/** The keys of every group above the item, outermost first. */
export const ancestorKeys = (item: TakItem): string[] => {
  const path = groupOf(item);
  return path.map((_, i) => path.slice(0, i + 1).join("/"));
};
