const pad = (n: number) => String(n).padStart(2, "0");

/**
 * House timestamp dialect: 24-hour, day.month, never locale-dependent —
 * two screens in the same ops room must render the same instant identically.
 */
export const formatDateTime = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Compact variant for dense feeds: `22.08. 14:35`. */
export const formatShortDateTime = (iso: string): string => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
