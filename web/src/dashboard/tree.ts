export type FolderNode = { kind: "folder"; name: string; path: string; children: TreeNode[] };
export type ItemNode = { kind: "item"; name: string; id: string };
export type TreeNode = FolderNode | ItemNode;

const byKindThenName = (a: TreeNode, b: TreeNode) =>
  a.kind !== b.kind
    ? a.kind === "folder"
      ? -1
      : 1
    : a.name.localeCompare(b.name, undefined, { numeric: true });

const sortTree = (nodes: TreeNode[]): TreeNode[] =>
  nodes
    .map((n) => (n.kind === "folder" ? { ...n, children: sortTree(n.children) } : n))
    .sort(byKindThenName);

/** Folders come from the name itself: "Ops/Medical/Triage" is Triage in Ops › Medical. */
export const buildTree = (items: { id: string; name: string }[]): TreeNode[] => {
  const root: TreeNode[] = [];
  for (const item of items) {
    const segments = item.name
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    const leaf = segments.pop() ?? item.name;
    let level = root;
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      let folder = level.find((n): n is FolderNode => n.kind === "folder" && n.name === segment);
      if (!folder) {
        folder = { kind: "folder", name: segment, path, children: [] };
        level.push(folder);
      }
      level = folder.children;
    }
    level.push({ kind: "item", name: leaf, id: item.id });
  }
  return sortTree(root);
};
