export const RECENT_KEY = "battlelog.recent";

const RECENT_MAX = 6;

export const withOpened = (ids: string[], id: string) =>
  [id, ...ids.filter((i) => i !== id)].slice(0, RECENT_MAX);

/** Per device, like favorites: what this screen has had open lately. */
export const rememberOpened = (id: string) => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const ids = raw ? (JSON.parse(raw) as string[]) : [];
    localStorage.setItem(RECENT_KEY, JSON.stringify(withOpened(ids, id)));
  } catch {
    // storage denied — Home just has no recent list
  }
};
