import { useStoredSetting } from "../../stored-setting.ts";
import { formatBinding, type KeyOverrides, keymapOf } from "./bindings.ts";

/** This browser's shortcuts: the defaults with the viewer's changes over them. */
export const useKeymap = () => {
  const [overrides, setOverrides] = useStoredSetting<KeyOverrides>({
    key: "battlelog.tak.keybindings",
    defaultValue: {},
  });
  const keymap = keymapOf(overrides);
  /** An action's first key as a Kbd shows it, if it has one. */
  const shortcutOf = (id: string) => {
    const first = keymap.get(id)?.[0];
    return first ? formatBinding(first) : undefined;
  };
  return { overrides, setOverrides, keymap, shortcutOf };
};
