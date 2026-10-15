/**
 * Keyboard shortcuts: what each action defaults to, the viewer's changes, and
 * matching a key press. A binding is a string like "m", "shift+m", "mod+z"
 * or "/"; "mod" is Ctrl, or ⌘ on a Mac.
 */

export const ACTION_GROUPS = ["General", "Drawers", "Draw", "Map"] as const;

export type KeyAction = {
  id: string;
  label: string;
  group: (typeof ACTION_GROUPS)[number];
  defaults: string[];
};

const drawer = (id: string, label: string, key: string): KeyAction => ({
  id: `drawer.${id}`,
  label,
  group: "Drawers",
  defaults: [key],
});

export const ACTIONS: KeyAction[] = [
  { id: "commandBar", label: "Search and commands", group: "General", defaults: ["/", "mod+k"] },
  { id: "shortcuts", label: "List the shortcuts", group: "General", defaults: ["?"] },
  { id: "undo", label: "Undo the latest change", group: "General", defaults: ["mod+z"] },
  { id: "centre", label: "Centre on the selection", group: "General", defaults: ["c"] },
  { id: "laser", label: "Laser pointer", group: "General", defaults: ["l"] },
  drawer("items", "Items", "1"),
  drawer("missions", "Data Sync", "2"),
  drawer("plans", "Plans", "3"),
  drawer("layers", "Layers", "4"),
  drawer("chat", "Chat", "5"),
  drawer("contacts", "Contacts", "6"),
  drawer("checklists", "Checklists", "7"),
  drawer("settings", "Settings", "8"),
  { id: "drawingTools", label: "Drawing tools", group: "Draw", defaults: ["d"] },
  { id: "draw.marker", label: "Marker", group: "Draw", defaults: ["m"] },
  { id: "draw.route", label: "Route", group: "Draw", defaults: ["r"] },
  { id: "draw.polygon", label: "Area", group: "Draw", defaults: ["a"] },
  { id: "measure", label: "Measure", group: "Draw", defaults: ["shift+m"] },
  { id: "lasso", label: "Lasso select", group: "Draw", defaults: [] },
  { id: "mgrsGrid", label: "MGRS grid on or off", group: "Map", defaults: ["g"] },
  { id: "tracks", label: "Tracks on or off", group: "Map", defaults: ["t"] },
  { id: "dim", label: "Dim the background map", group: "Map", defaults: ["n"] },
  { id: "replay", label: "Replay history", group: "Map", defaults: ["h"] },
  { id: "locate", label: "Locate me", group: "Map", defaults: ["shift+l"] },
];

/** The viewer's changes: an action's keys, or [] to leave it without one. */
export type KeyOverrides = Record<string, string[]>;
export type Keymap = Map<string, string[]>;

const isKeys = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((k) => typeof k === "string");

/** Overrides come from storage or an imported file, so a malformed one falls back to the default. */
export const keymapOf = (overrides: KeyOverrides): Keymap =>
  new Map(
    ACTIONS.map((a) => {
      const own: unknown = overrides?.[a.id];
      return [a.id, isKeys(own) ? own : a.defaults];
    }),
  );

const MODIFIERS = new Set(["Control", "Meta", "Alt", "Shift", "AltGraph", "CapsLock"]);

/**
 * The binding a key press stands for, or undefined for a lone modifier.
 * Shift is dropped only from symbols: "/" and "?" need Shift on some layouts
 * and not on others, and the character is what the viewer means.
 */
export const bindingOf = (
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
) => {
  if (MODIFIERS.has(e.key)) return undefined;
  const key = e.key === " " ? "space" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const symbol = key.length === 1 && !/^\p{L}$/u.test(key);
  return [
    (e.ctrlKey || e.metaKey) && "mod",
    e.altKey && "alt",
    e.shiftKey && !symbol && "shift",
    key,
  ]
    .filter(Boolean)
    .join("+");
};

/** The map's own: arrows pan and rotate, + and - zoom. Also Tab, Enter and Esc, which dialogs and lists need. */
export const isReserved = (binding: string) =>
  /(^|\+)(Arrow\w+|[-+=]|Tab|Enter|Escape)$/.test(binding);

/** The action a binding runs, if any. */
export const actionFor = (keymap: Keymap, binding: string) =>
  [...keymap].find(([, keys]) => keys.includes(binding))?.[0];

/** Gives `id` this binding alone, taking it from whichever action had it. */
export const assign = (
  overrides: KeyOverrides,
  keymap: Keymap,
  id: string,
  binding: string,
): { overrides: KeyOverrides; takenFrom?: string } => {
  const takenFrom = actionFor(keymap, binding);
  const next = { ...overrides, [id]: [binding] };
  if (takenFrom && takenFrom !== id)
    next[takenFrom] = (keymap.get(takenFrom) ?? []).filter((k) => k !== binding);
  return { overrides: next, takenFrom: takenFrom === id ? undefined : takenFrom };
};

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

const NAMES: Record<string, string> = {
  space: "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** For a Kbd: "Ctrl Z" or "⌘ Z", "Shift M", "/". */
export const formatBinding = (binding: string, mac = isMac()) =>
  binding
    .split("+")
    .map((part) =>
      part === "mod"
        ? mac
          ? "⌘"
          : "Ctrl"
        : part === "alt"
          ? mac
            ? "⌥"
            : "Alt"
          : part === "shift"
            ? "Shift"
            : (NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part)),
    )
    .join(" ");

/** Back to the action's defaults, taking those keys from whichever actions had them since. */
export const resetAction = (overrides: KeyOverrides, keymap: Keymap, id: string): KeyOverrides => {
  const { [id]: _, ...next } = overrides;
  const defaults = ACTIONS.find((a) => a.id === id)?.defaults ?? [];
  for (const [other, keys] of keymap) {
    if (other !== id && keys.some((k) => defaults.includes(k)))
      next[other] = keys.filter((k) => !defaults.includes(k));
  }
  return next;
};
