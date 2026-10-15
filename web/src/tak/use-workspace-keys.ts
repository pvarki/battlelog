import { useEffect } from "react";
import { actionFor, bindingOf, type Keymap } from "./keys/bindings.ts";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** The map page's keyboard: the viewer's shortcuts run `actions`, and Esc steps back once. */
export const useWorkspaceKeys = ({
  keymap,
  actions,
  onEscape,
}: {
  keymap: Keymap;
  actions: Record<string, () => void>;
  onEscape: () => void;
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog owns its keys, Esc included: closing one mustn't also clear the map.
      if (
        e.defaultPrevented ||
        (e.target instanceof Element && e.target.closest('[role="dialog"]'))
      )
        return;
      if (e.key === "Escape") return onEscape();
      const binding = bindingOf(e);
      const action = binding && actionFor(keymap, binding);
      if (!action) return;
      // Typing keeps its keys; only a modified command-bar shortcut reaches past a field.
      if (isTyping(e.target) && !(action === "commandBar" && binding.startsWith("mod+"))) return;
      e.preventDefault();
      actions[action]?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
};
