import { notifications } from "@mantine/notifications";
import { useEffect, useRef } from "react";
import {
  type Alert,
  loadAlertRules,
  matchesAlert,
  raisedKey,
  SEVERITY_COLOUR,
  SEVERITY_LABEL,
} from "./alerts.ts";
import { subscribeToEvents } from "./live-events.ts";

// A critical alert stays until it is clicked away; the quieter ones expire, so a
// wall display is not permanently covered in toasts nobody will dismiss.
const AUTO_CLOSE_MS: Record<Alert["severity"], number | false> = {
  info: 8_000,
  warn: 20_000,
  critical: false,
};

/**
 * How often the rule list is re-read.
 *
 * Rules change in the settings drawer of a board this tab may not even be on, so
 * there is nothing to hook. A poll is the whole mechanism: one small request,
 * and a rule someone just typed starts firing within a minute.
 */
const RULES_REFRESH_MS = 60_000;

/**
 * How many raised-alert keys to remember, so a reconnect's replay does not
 * re-announce alerts already shown.
 *
 * Bounded because this tab may be a wall display left running for weeks: an
 * unbounded set grows with every event for as long as the page is open. Far more
 * than a replay window, and the keys are short strings.
 */
const SEEN_LIMIT = 5_000;

/**
 * App-wide alert notifications.
 *
 * Mounted once in the root layout rather than in the feed widget, for two
 * reasons: an alert has to reach the operator on whatever page they are on, and
 * a rule that several boards happen to share must not produce one toast per
 * board. The widget's own job is the flash on the tile, which is about that tile.
 */
export const useAlertWatcher = (): void => {
  const rulesRef = useRef<{ alert: Alert; source: string }[]>([]);
  // Rows are replayed on reconnect (Last-Event-ID), so the same event can arrive
  // more than once — without this every reconnect re-announces the same alerts.
  const seenRef = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void loadAlertRules()
        .then((rules) => {
          if (alive) rulesRef.current = rules;
        })
        .catch(() => {
          // Keep whatever rules we already had; a failed poll must not silence
          // alerts that were working a minute ago.
        });
    };
    refresh();
    const timer = setInterval(refresh, RULES_REFRESH_MS);

    const stop = subscribeToEvents((row) => {
      for (const { alert, source } of rulesRef.current) {
        if (!matchesAlert(row, alert)) continue;
        const key = raisedKey(alert.id, row.id);
        if (seenRef.current.has(key)) continue;
        seenRef.current.add(key);
        if (seenRef.current.size > SEEN_LIMIT) {
          // Sets iterate in insertion order, so this drops the oldest keys.
          const keep = [...seenRef.current].slice(-SEEN_LIMIT / 2);
          seenRef.current = new Set(keep);
        }
        notifications.show({
          id: key,
          title: `${SEVERITY_LABEL[alert.severity]}: ${alert.label}`,
          message: `${row.header} — ${source}`,
          color: SEVERITY_COLOUR[alert.severity],
          autoClose: AUTO_CLOSE_MS[alert.severity],
        });
      }
    });

    return () => {
      alive = false;
      clearInterval(timer);
      stop();
    };
  }, []);
};
