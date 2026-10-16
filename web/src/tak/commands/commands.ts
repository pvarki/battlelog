import type { ReactNode } from "react";

/** Where a command is listed; results show in this order. */
export const GROUPS = [
  "Recent",
  "Coordinates",
  "Items",
  "Go to",
  "Draw",
  "Map",
  "Data Sync feeds",
  "Plans",
  "Actions",
] as const;
export type CommandGroup = (typeof GROUPS)[number];

export type Command = {
  /** Stable across sessions, so recents survive a reload. */
  id: string;
  group: CommandGroup;
  label: string;
  /** A dimmed second line: an item's type, a toggle's state. */
  detail?: string;
  keywords?: string[];
  shortcut?: string;
  icon?: ReactNode;
  /** Why it can't run now; listed but greyed out. */
  disabledReason?: string;
  run: () => void;
  /** What Tab offers for this result; Enter runs `run`. */
  actions?: () => Command[];
};

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[\s·,/()-]+/)
    .filter(Boolean);

/** Lower is better; undefined when the query doesn't match. */
export const score = (command: Command, query: string): number | undefined => {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const label = command.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (words(command.label).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  if (command.keywords?.some((k) => k.toLowerCase().startsWith(q))) return 3;
  if (command.detail?.toLowerCase().includes(q)) return 4;
  return undefined;
};

/** The commands matching `query`, best first within each group, groups in `GROUPS` order. */
export const rank = (commands: Command[], query: string, perGroup = 8) => {
  const scored = commands.flatMap((command, order) => {
    const s = score(command, query);
    return s === undefined ? [] : [{ command, s, order }];
  });
  return GROUPS.flatMap((group) => {
    const hits = scored
      .filter((h) => h.command.group === group)
      .sort((a, b) => a.s - b.s || a.order - b.order)
      .slice(0, perGroup)
      .map((h) => h.command);
    return hits.length ? [{ group, commands: hits }] : [];
  });
};

export const MAX_RECENT = 5;

/** Most recent first, without repeats. */
export const remember = (recent: string[], id: string) =>
  [id, ...recent.filter((r) => r !== id)].slice(0, MAX_RECENT);
