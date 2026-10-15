import { expect, test } from "vitest";
import { applySettings, readSettingsFile, settingsFile } from "./settings-file.ts";

const memoryStorage = (entries: Record<string, string> = {}): Storage => {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
};

test("only BattleLog's settings travel, and come back as they were", () => {
  const from = memoryStorage({
    "battlelog.tak.mgrsGrid": "true",
    "battlelog.tak.keybindings": '{"laser":["p"]}',
    "battlelog.matrix.session": '{"accessToken":"secret"}',
    "someone-else": "x",
  });
  const to = memoryStorage({ "battlelog.tak.mgrsGrid": "false" });
  applySettings(to, readSettingsFile(settingsFile(from)));
  expect(to.getItem("battlelog.tak.mgrsGrid")).toBe("true");
  expect(to.getItem("battlelog.tak.keybindings")).toBe('{"laser":["p"]}');
  expect(to.getItem("someone-else")).toBeNull();
  expect(settingsFile(from)).not.toContain("secret");
});

test("a file that isn't ours says so, and foreign keys inside one are dropped", () => {
  expect(() => readSettingsFile("nope")).toThrow("isn't JSON");
  expect(() => readSettingsFile('{"settings":{}}')).toThrow("isn't a BattleLog settings file");
  const read = readSettingsFile(
    JSON.stringify({
      app: "battlelog-settings",
      version: 1,
      settings: {
        "battlelog.a": "1",
        other: "2",
        "battlelog.b": 3,
        "battlelog.c": "{broken",
        "battlelog.matrix.session": "{}",
      },
    }),
  );
  expect(read).toEqual({ "battlelog.a": "1" });
});
