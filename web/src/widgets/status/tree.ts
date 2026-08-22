import type { StatusRow } from "./widget.ts";

export const MAX_DEPTH = 3;

/** "a / b / c / d" → ["a", "b", "c / d"]: trimmed segments, capped at 3 levels. */
export const parseLabel = (label: string): string[] => {
  const parts = label
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [label.trim() || label];
  if (parts.length <= MAX_DEPTH) return parts;
  return [...parts.slice(0, MAX_DEPTH - 1), parts.slice(MAX_DEPTH - 1).join(" / ")];
};

export type StatusNode = {
  name: string;
  path: string;
  depth: number;
  /** Set when a configured row maps exactly to this path — a group root with
   * its own status carries both children and a chip. */
  row?: StatusRow;
  children: StatusNode[];
};

/**
 * Groups are derived purely from `/` in labels — no config-schema impact.
 * Nodes appear in the order their path is first mentioned, children under
 * their parent.
 */
export const buildStatusTree = (rows: StatusRow[]): StatusNode[] => {
  const roots: StatusNode[] = [];
  const byPath = new Map<string, StatusNode>();
  for (const row of rows) {
    let path = "";
    let siblings = roots;
    let node: StatusNode | undefined;
    for (const [depth, name] of parseLabel(row.label).entries()) {
      path = path ? `${path}/${name}` : name;
      node = byPath.get(path);
      if (!node) {
        node = { name, path, depth, children: [] };
        byPath.set(path, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
    if (node) node.row = row;
  }
  return roots;
};

/** Depth-first flatten for rendering: parent, then its children. */
export const flattenTree = (nodes: StatusNode[]): StatusNode[] =>
  nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
