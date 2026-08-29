import { ActionIcon, Box, Center, Stack, Text } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import {
  type Alert,
  dismissAlert,
  dismissedKeys,
  freshAlertKeys,
  loadAlertRules,
  matchesAlert,
  type RaisedAlert,
  raisedKey,
  SEVERITIES,
  SEVERITY_COLOUR,
  SEVERITY_LABEL,
} from "./alerts.ts";
import type { EventResponse } from "./api.ts";
import { useLiveEvents } from "./live-events.ts";
import { formatShortDateTime } from "./time.ts";

/**
 * The alerts list and the state behind it, shared by the two things that show
 * alerts: the header's bell and the optional board widget. One implementation,
 * because two would drift and the disagreement would be about whether an alert
 * has been acknowledged.
 */

/**
 * How often the rule list is re-read.
 *
 * Rules are edited in the settings drawer of a board this view may not be on, so
 * there is nothing to hook. A poll is the whole mechanism: one small request, and
 * a rule someone just typed starts firing within a minute.
 */
const RULES_REFRESH_MS = 60_000;

/**
 * The row is a grid, not a flex line.
 *
 * Severity used to be a text badge, so "Info" and "KRIITTINEN" gave every row a
 * different geometry. Nothing in a row sizes itself now: a colour bar carries the
 * severity for scanning, the word lives in the meta line where it flows as prose,
 * and the three tracks are fixed / flexible / fixed.
 */
const ROW_COLUMNS = "4px 1fr 28px";

// Reserve the scrollbar's width so the tick in the last column is never under
// it. `scrollbar-gutter` covers the browsers that have it; the padding covers
// the overlay-scrollbar ones, where the property does nothing.
const SCROLL_STYLE = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  scrollbarGutter: "stable",
  paddingRight: 6,
} as const;

/** Every alert the given rules raise over the given events, newest first. */
export const raisedAlerts = (
  events: readonly EventResponse[],
  rules: readonly { alert: Alert; source: string }[],
): RaisedAlert[] => {
  const raised: RaisedAlert[] = [];
  for (const event of events) {
    for (const { alert, source } of rules) {
      // One event can raise several rules and each pairing is its own entry: two
      // rules firing on one message is two things for someone to acknowledge.
      if (matchesAlert(event, alert)) {
        raised.push({ key: raisedKey(alert.id, event.id), alert, event, source });
      }
    }
  }
  return raised.sort((a, b) => b.event.createdAt.localeCompare(a.event.createdAt));
};

export type AlertsState = {
  ready: boolean;
  /** Rules could not be loaded — distinct from there being none. */
  failed: boolean;
  rules: { alert: Alert; source: string }[];
  raised: RaisedAlert[];
  /** Not acknowledged, newest first. */
  open: RaisedAlert[];
  /** The loudest open alert: what a one-line summary has to carry. */
  worst: RaisedAlert | undefined;
  isDismissed: (key: string) => boolean;
  dismiss: (raised: RaisedAlert) => void;
};

export const useAlerts = (lookback: number): AlertsState => {
  const [rules, setRules] = useState<{ alert: Alert; source: string }[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Optimistic: acknowledging is a POST plus a round trip through the stream,
  // and a button that does nothing for a second invites a second click.
  const [justDismissed, setJustDismissed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void loadAlertRules()
        .then((loaded) => {
          if (alive) setRules(loaded);
        })
        .catch(() => {
          if (alive) {
            // Keep whatever rules we had; a failed poll must not silence alerts
            // that were working a minute ago.
            setRules((cur) => cur ?? []);
            setFailed(true);
          }
        });
    refresh();
    const timer = setInterval(refresh, RULES_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Unfiltered: the rules are a union and the events API filters by AND, so
  // narrowing server-side would drop what a second rule was watching for.
  const { events } = useLiveEvents({ limit: lookback });

  const ready = Boolean(events && rules);
  const cleared = events ? dismissedKeys(events) : new Set<string>();
  const raised = events && rules ? raisedAlerts(events, rules) : [];
  const isDismissed = (key: string) => cleared.has(key) || justDismissed.has(key);
  const open = raised.filter((r) => !isDismissed(r.key));

  return {
    ready,
    failed,
    rules: rules ?? [],
    raised,
    open,
    worst: [...open].sort(
      (a, b) => SEVERITIES.indexOf(b.alert.severity) - SEVERITIES.indexOf(a.alert.severity),
    )[0],
    isDismissed,
    dismiss: (r) => {
      setJustDismissed((prev) => new Set(prev).add(r.key));
      void dismissAlert(r).then((ok) => {
        // Failed POST: put it back rather than leaving a cleared alert that
        // nothing recorded.
        if (!ok) {
          setJustDismissed((prev) => {
            const next = new Set(prev);
            next.delete(r.key);
            return next;
          });
        }
      });
    },
  };
};

/**
 * Open state that unfolds itself when an alert arrives.
 *
 * Deliberately not on load: the announced set is seeded from the first render
 * that has data, so a view opens folded over the backlog and only unfolds for
 * something that happened while someone was watching.
 */
export const useAutoUnfold = (
  ready: boolean,
  openKeys: readonly string[],
): [boolean, (open: boolean) => void] => {
  const [opened, setOpened] = useState(false);
  const announced = useRef<Set<string> | null>(null);
  const joined = openKeys.join(",");

  useEffect(() => {
    if (!ready) return;
    const keys = joined ? joined.split(",") : [];
    const fresh = freshAlertKeys(keys, announced.current);
    announced.current = new Set([...(announced.current ?? []), ...keys]);
    if (fresh.length) setOpened(true);
  }, [ready, joined]);

  return [opened, setOpened];
};

const AlertRow = ({
  raised,
  dismissed,
  onDismiss,
}: {
  raised: RaisedAlert;
  dismissed: boolean;
  onDismiss: () => void;
}) => (
  <Box
    style={{
      display: "grid",
      gridTemplateColumns: ROW_COLUMNS,
      gap: 8,
      alignItems: "start",
      padding: "4px 0",
      borderBottom: "1px solid var(--mantine-color-dark-5)",
      opacity: dismissed ? 0.5 : 1,
    }}
  >
    <Box
      style={{
        alignSelf: "stretch",
        borderRadius: 2,
        background: `var(--mantine-color-${SEVERITY_COLOUR[raised.alert.severity]}-${dismissed ? 8 : 5})`,
      }}
    />
    <Stack gap={0} style={{ minWidth: 0 }}>
      <Text fz="xs" fw={600} td={dismissed ? "line-through" : undefined} lineClamp={2}>
        {raised.event.header}
      </Text>
      <Text fz="xs" c="dimmed" truncate>
        {SEVERITY_LABEL[raised.alert.severity]} · {raised.alert.label} · {raised.source} ·{" "}
        {formatShortDateTime(raised.event.eventTime ?? raised.event.createdAt)}
      </Text>
    </Stack>
    <Center>
      {dismissed ? (
        // A static tick, not an empty gap: the column stays reserved for
        // alignment, and while it is there it may as well say why.
        <IconCheck size={14} stroke={2} aria-label="Kuitattu" />
      ) : (
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={`Kuittaa: ${raised.alert.label}`}
          title="Kuittaa"
          onClick={onDismiss}
        >
          <IconCheck size={16} stroke={2} />
        </ActionIcon>
      )}
    </Center>
  </Box>
);

/** The scrolling list of raised alerts, acknowledged ones greyed in place. */
export const AlertsList = ({ state }: { state: AlertsState }) => (
  <Box style={SCROLL_STYLE}>
    {state.raised.length === 0 ? (
      <Text fz="xs" c="dimmed" p="xs">
        {state.rules.length === 0
          ? state.failed
            ? "Hälytyssääntöjä ei voitu ladata."
            : "Yhtään hälytystä ei ole määritelty. Hälytykset asetetaan tapahtumasyöte-widgetin asetuksissa."
          : `Ei hälytyksiä. ${state.rules.length} sääntöä valvonnassa: ${state.rules
              .map((r) => r.alert.label)
              .join(", ")}.`}
      </Text>
    ) : (
      state.raised.map((r) => (
        <AlertRow
          key={r.key}
          raised={r}
          dismissed={state.isDismissed(r.key)}
          onDismiss={() => state.dismiss(r)}
        />
      ))
    )}
  </Box>
);

export const AlertsFooter = ({ state, lookback }: { state: AlertsState; lookback: number }) => (
  <Text fz="xs" c="dimmed" ta="right">
    {state.open.length} avoinna · {state.raised.length - state.open.length} kuitattu ·{" "}
    {state.rules.length} sääntöä · {lookback} viimeisintä tapahtumaa
  </Text>
);
