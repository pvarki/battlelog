import {
  ActionIcon,
  Box,
  Center,
  Group,
  Loader,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconBellRinging, IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import {
  type Alert,
  dismissAlert,
  dismissedKeys,
  loadAlertRules,
  type RaisedAlert,
  SEVERITIES,
  SEVERITY_COLOUR,
  SEVERITY_LABEL,
} from "../../alerts.ts";
import { useIsMobile } from "../../dashboard/mobile.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { useLiveEvents } from "../../live-events.ts";
import { formatShortDateTime } from "../../time.ts";
import { type AlertsConfig, raisedAlerts } from "./widget.ts";

/**
 * The row is a grid, not a flex line.
 *
 * Severity used to be a text badge, so "Info" and "KRIITTINEN" gave every row a
 * different geometry. Nothing in a row is allowed to size itself now: a colour
 * bar carries the severity for scanning, the word moves into the meta line where
 * it flows as prose, and the three tracks below are fixed / flexible / fixed.
 */
const ROW_COLUMNS = "4px 1fr 28px";

// Reserve the scrollbar's width so the tick in the last column is never under
// it. `scrollbar-gutter` handles the browsers that have it; the padding covers
// the overlay-scrollbar ones, where the gutter property does nothing.
const SCROLL_STYLE = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  scrollbarGutter: "stable",
  paddingRight: 6,
} as const;

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

const AlertsView = ({ config }: WidgetViewProps<AlertsConfig>) => {
  // On a phone this widget is one tab with the whole screen to itself, so
  // folding it would hide the list behind a tap for nothing. On a desktop board
  // it sits among other tiles and has to stay out of their way until it has
  // something to say.
  const isMobile = useIsMobile();
  const [opened, setOpened] = useState(false);
  const [rules, setRules] = useState<{ alert: Alert; source: string }[] | null>(null);
  // Optimistic: the acknowledgement is a POST plus a round trip through the
  // stream, and a button that does nothing for a second invites a second click.
  const [justDismissed, setJustDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState(false);
  // Open alerts this widget has already shown. Null until the first render has
  // been counted, which is what keeps a board from unfolding on every page load
  // over alerts that were already there.
  const announced = useRef<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    void loadAlertRules()
      .then((loaded) => {
        if (alive) setRules(loaded);
      })
      .catch(() => {
        if (alive) {
          setRules([]);
          setFailed(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Unfiltered: the rules are a union and the events API filters by AND, so
  // narrowing server-side would drop what a second rule was watching for. The
  // lookback is the honest limit, and the footer says so.
  const { events } = useLiveEvents({ limit: config.lookback });

  const cleared = events ? dismissedKeys(events) : new Set<string>();
  const raised = events && rules ? raisedAlerts(events, rules) : [];
  const isDismissed = (key: string) => cleared.has(key) || justDismissed.has(key);
  // Acknowledged alerts stay on the list, greyed. Acknowledging is a statement
  // that someone has seen it, not a way to make it go away — a list you can tap
  // empty cannot be read as "this is what happened".
  const open = raised.filter((r) => !isDismissed(r.key));
  const openKeys = open.map((r) => r.key).join(",");

  // A new alert unfolds the card. Folded, the count changing is easy to miss on
  // a wall of tiles, and an alert nobody notices is not an alert.
  const ready = Boolean(events && rules);
  useEffect(() => {
    // Not until the data is in: initialising from the empty pre-load state would
    // make every existing alert look new and unfold the card on every page load.
    if (!ready) return;
    const keys = openKeys ? openKeys.split(",") : [];
    if (announced.current === null) {
      announced.current = new Set(keys);
      return;
    }
    const fresh = keys.filter((k) => !announced.current?.has(k));
    for (const k of keys) announced.current.add(k);
    if (fresh.length) setOpened(true);
  }, [ready, openKeys]);

  if (!rules || !events) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  if (rules.length === 0) {
    return (
      <Stack h="100%" px="xs" justify="center">
        <Text fz="xs" c="dimmed" ta="center">
          {failed
            ? "Hälytyssääntöjä ei voitu ladata."
            : "Yhtään hälytystä ei ole määritelty. Hälytykset asetetaan tapahtumasyöte-widgetin asetuksissa."}
        </Text>
      </Stack>
    );
  }

  // The loudest open alert sets the folded bar: folded, that one line is all
  // there is, so it has to carry the worst case rather than the most recent one.
  const worst = [...open].sort(
    (a, b) => SEVERITIES.indexOf(b.alert.severity) - SEVERITIES.indexOf(a.alert.severity),
  )[0];

  const dismiss = (r: RaisedAlert) => {
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
  };

  const list = (
    <Box style={SCROLL_STYLE}>
      {raised.length === 0 ? (
        <Text fz="xs" c="dimmed" p="xs">
          Ei hälytyksiä. {rules.length} sääntöä valvonnassa:{" "}
          {rules.map((r) => r.alert.label).join(", ")}.
        </Text>
      ) : (
        raised.map((r) => (
          <AlertRow
            key={r.key}
            raised={r}
            dismissed={isDismissed(r.key)}
            onDismiss={() => dismiss(r)}
          />
        ))
      )}
    </Box>
  );

  const footer = (
    <Text fz="xs" c="dimmed" ta="right">
      {open.length} avoinna · {raised.length - open.length} kuitattu · {rules.length} sääntöä ·{" "}
      {config.lookback} viimeisintä tapahtumaa
    </Text>
  );

  if (isMobile) {
    return (
      <Stack h="100%" gap="xs" p="xs">
        {list}
        {footer}
      </Stack>
    );
  }

  const worstColour = SEVERITY_COLOUR[worst?.alert.severity ?? "info"];
  const Chevron = opened ? IconChevronUp : IconChevronDown;

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width="target"
      // Flush against the bar, so the two read as one card that unfolded rather
      // than as a tooltip floating near it.
      offset={2}
      shadow="md"
      // Portalled, so the unfolded list draws over the neighbouring tiles rather
      // than being clipped inside this one.
      withinPortal
      trapFocus={false}
    >
      <Popover.Target>
        <UnstyledButton
          onClick={() => setOpened((o) => !o)}
          h="100%"
          w="100%"
          px="xs"
          aria-expanded={opened}
          aria-label={`Hälytykset: ${open.length} avoinna`}
        >
          <Group gap="xs" wrap="nowrap" h="100%">
            <IconBellRinging
              size={18}
              stroke={1.5}
              style={{
                flexShrink: 0,
                color: worst ? `var(--mantine-color-${worstColour}-5)` : undefined,
              }}
            />
            {open.length > 0 ? (
              <>
                {/* Fixed width, so the bar does not reflow as the count and the
                    worst severity change under it. */}
                <Text fz="xs" fw={700} c={`${worstColour}.4`} w={72} style={{ flexShrink: 0 }}>
                  {open.length} avoinna
                </Text>
                <Text fz="xs" c="dimmed" truncate>
                  {worst?.event.header}
                </Text>
              </>
            ) : (
              <Text fz="xs" c="dimmed" truncate>
                Ei avoimia hälytyksiä · {raised.length} kuitattu
              </Text>
            )}
            <Chevron size={14} stroke={2} style={{ flexShrink: 0, marginLeft: "auto" }} />
          </Group>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Stack gap="xs" style={{ maxHeight: "50vh" }}>
          {list}
          {footer}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

export default AlertsView;
