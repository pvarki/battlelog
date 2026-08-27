import { ActionIcon, Badge, Center, Group, Loader, Stack, Text } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  type Alert,
  dismissAlert,
  dismissedKeys,
  loadAlertRules,
  type RaisedAlert,
  SEVERITY_COLOUR,
  SEVERITY_LABEL,
} from "../../alerts.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { useLiveEvents } from "../../live-events.ts";
import { formatShortDateTime } from "../../time.ts";
import { type AlertsConfig, raisedAlerts } from "./widget.ts";

const AlertRow = ({
  raised,
  dismissed,
  onDismiss,
}: {
  raised: RaisedAlert;
  dismissed: boolean;
  onDismiss: () => void;
}) => (
  <Group gap="xs" wrap="nowrap" align="flex-start" opacity={dismissed ? 0.45 : 1}>
    <Badge
      color={SEVERITY_COLOUR[raised.alert.severity]}
      variant={dismissed ? "outline" : "filled"}
      size="xs"
      style={{ flexShrink: 0, marginTop: 2 }}
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
    {!dismissed && (
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        aria-label={`Kuittaa: ${raised.alert.label}`}
        title="Kuittaa"
        onClick={onDismiss}
        style={{ flexShrink: 0 }}
      >
        <IconCheck size={16} stroke={2} />
      </ActionIcon>
    )}
  </Group>
);

const AlertsView = ({ config }: WidgetViewProps<AlertsConfig>) => {
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
      <Stack h="100%" p="xs" justify="center">
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
  const open = raised.filter((r) => !isDismissed(r.key)).length;

  return (
    <Stack h="100%" gap="xs" p="xs">
      <Stack gap={6} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {raised.length === 0 ? (
          <Text fz="xs" c="dimmed">
            Ei hälytyksiä. {rules.length} sääntöä valvonnassa:{" "}
            {rules.map((r) => r.alert.label).join(", ")}.
          </Text>
        ) : (
          raised.map((r) => (
            <AlertRow
              key={r.key}
              raised={r}
              dismissed={isDismissed(r.key)}
              onDismiss={() => {
                setJustDismissed((prev) => new Set(prev).add(r.key));
                void dismissAlert(r).then((ok) => {
                  // Failed POST: put it back rather than leaving a cleared alert
                  // that nothing recorded.
                  if (!ok) {
                    setJustDismissed((prev) => {
                      const next = new Set(prev);
                      next.delete(r.key);
                      return next;
                    });
                  }
                });
              }}
            />
          ))
        )}
      </Stack>
      <Text fz="xs" c="dimmed" ta="right">
        {open} avoinna · {rules.length} sääntöä · {config.lookback} viimeisintä tapahtumaa
      </Text>
    </Stack>
  );
};

export default AlertsView;
