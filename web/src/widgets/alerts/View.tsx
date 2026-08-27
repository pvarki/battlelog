import {
  ActionIcon,
  Badge,
  Center,
  Group,
  Loader,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconBellRinging, IconCheck } from "@tabler/icons-react";
import { useEffect, useState } from "react";
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
 * Fixed widths for the two edge columns.
 *
 * "Info" and "Kriittinen" are very different lengths, and an acknowledged row
 * has no button to press — left to themselves both make every row start and end
 * at a different x, which is what turns a list into a mess. The columns are
 * reserved instead, so only the middle one flexes.
 */
const SEVERITY_COLUMN = 78;
const ACTION_COLUMN = 26;

const AlertRow = ({
  raised,
  dismissed,
  onDismiss,
}: {
  raised: RaisedAlert;
  dismissed: boolean;
  onDismiss: () => void;
}) => (
  <Group
    gap="xs"
    wrap="nowrap"
    align="flex-start"
    py={4}
    style={{ borderBottom: "1px solid var(--mantine-color-dark-5)" }}
    opacity={dismissed ? 0.5 : 1}
  >
    <Badge
      color={SEVERITY_COLOUR[raised.alert.severity]}
      variant={dismissed ? "outline" : "filled"}
      size="xs"
      w={SEVERITY_COLUMN}
      style={{ flexShrink: 0 }}
    >
      {SEVERITY_LABEL[raised.alert.severity]}
    </Badge>
    <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
      <Text fz="xs" fw={600} td={dismissed ? "line-through" : undefined} lineClamp={2}>
        {raised.event.header}
      </Text>
      <Text fz="xs" c="dimmed" truncate>
        {raised.alert.label} · {raised.source} ·{" "}
        {formatShortDateTime(raised.event.eventTime ?? raised.event.createdAt)}
      </Text>
    </Stack>
    <Center w={ACTION_COLUMN} style={{ flexShrink: 0 }}>
      {dismissed ? (
        // A static tick, not an empty gap: the column has to stay reserved for
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
  </Group>
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

  const cleared = dismissedKeys(events);
  const raised = raisedAlerts(events, rules);
  const isDismissed = (key: string) => cleared.has(key) || justDismissed.has(key);
  // Acknowledged alerts stay on the list, greyed. Acknowledging is a statement
  // that someone has seen it, not a way to make it go away — a list you can tap
  // empty cannot be read as "this is what happened".
  const open = raised.filter((r) => !isDismissed(r.key));
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
    <Stack gap={0} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
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
    </Stack>
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

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width={480}
      withArrow
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
                <Badge color={worstColour} size="sm" style={{ flexShrink: 0 }}>
                  {open.length} avoinna
                </Badge>
                <Text fz="xs" c="dimmed" truncate>
                  {worst?.event.header}
                </Text>
              </>
            ) : (
              <Text fz="xs" c="dimmed" truncate>
                Ei avoimia hälytyksiä · {raised.length} kuitattu
              </Text>
            )}
            <Text fz="xs" c="dimmed" ml="auto" style={{ flexShrink: 0 }}>
              {opened ? "▴" : "▾"}
            </Text>
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
