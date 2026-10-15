/**
 * This browser's BattleLog settings as a file, to carry them to another
 * browser or keep them past a short-lived deployment. Plans and the TAK
 * picture aren't settings: plans export as data packages. Sign-in state never travels.
 */

/**
 * Settings travel by allowlist: anything else under battlelog. is sign-in state
 * (a Matrix token), a cache (dashboards, whose widget configs can hold stream
 * URLs with tokens) or this browser's own state, and a new key stays home until added here.
 */
const SETTINGS = new Set([
  "battlelog.favorites",
  "battlelog.nav-filter",
  "battlelog.nav-open",
  "battlelog.explorer.sort",
]);
const TAK_PREFIX = "battlelog.tak.";
/** Map-page state that means nothing in another browser: its plans, last view and recent commands. */
const TAK_LOCAL = new Set([
  "battlelog.tak.activePlan",
  "battlelog.tak.view",
  "battlelog.tak.recentCommands",
]);

const isSetting = (key: string) =>
  SETTINGS.has(key) || (key.startsWith(TAK_PREFIX) && !TAK_LOCAL.has(key));

/** Every value is stored as JSON; one that isn't would break the setting reading it. */
const isJson = (value: string) => {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};
const APP = "battlelog-settings";

export const settingsFile = (storage: Storage): string => {
  const settings: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const value = key && isSetting(key) ? storage.getItem(key) : null;
    if (key && value !== null) settings[key] = value;
  }
  return JSON.stringify({ app: APP, version: 1, settings }, null, 2);
};

/** The settings in a file, or an error saying why it isn't one. */
export const readSettingsFile = (text: string): Record<string, string> => {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("The file isn't JSON.");
  }
  const settings = (file as { app?: unknown; settings?: unknown } | null)?.settings;
  if ((file as { app?: unknown } | null)?.app !== APP || !settings || typeof settings !== "object")
    throw new Error("It isn't a BattleLog settings file.");
  return Object.fromEntries(
    Object.entries(settings).filter(
      (entry): entry is [string, string] =>
        isSetting(entry[0]) && typeof entry[1] === "string" && isJson(entry[1]),
    ),
  );
};

export const applySettings = (storage: Storage, settings: Record<string, string>) => {
  for (const [key, value] of Object.entries(settings)) storage.setItem(key, value);
};
