const pad = (n: number) => String(n).padStart(2, "0");

/**
 * House timestamp dialect: 24-hour, day.month, never locale-dependent —
 * two screens in the same ops room must render the same instant identically.
 */
export const formatDateTime = (iso: string | number): string => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Compact variant for dense feeds: `22.08. 14:35`. */
export const formatShortDateTime = (iso: string | number): string => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Clock time only: `14:35`. */
export const formatClockTime = (iso: string | number): string => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Date only: `22.08.2026`. */
export const formatDate = (iso: string | number): string => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};

/** How long ago, coarsely: `45 s`, `12 min`, `6 h`, `3 d`. Add " ago" where it reads better. */
export const formatAge = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86_400)} d`;
};
