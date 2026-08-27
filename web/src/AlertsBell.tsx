import { Badge, Group, Popover, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconBellRinging } from "@tabler/icons-react";
import { SEVERITY_COLOUR } from "./alerts.ts";
import { AlertsFooter, AlertsList, useAlerts, useAutoUnfold } from "./alerts-panel.tsx";

/**
 * How many recent events the rules are checked against.
 *
 * Fixed rather than configurable: this lives in the app header, which has no
 * settings drawer, and the number only bounds how far back the list reaches.
 */
const LOOKBACK = 200;

/**
 * Alerts in the header.
 *
 * The header is the one thing on screen on every page and every board, so this is
 * where an alert can reach an operator without taking a tile from the board it is
 * about. Folded it is a bell and a count; it unfolds on a tap, and by itself when
 * an alert arrives.
 */
export const AlertsBell = () => {
  const state = useAlerts(LOOKBACK);
  const [opened, setOpened] = useAutoUnfold(
    state.ready,
    state.open.map((r) => r.key),
  );

  // Nothing configured anywhere: no bell at all rather than a control that
  // explains it has nothing to do.
  if (state.ready && state.rules.length === 0) return null;

  const colour = SEVERITY_COLOUR[state.worst?.alert.severity ?? "info"];

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      width={480}
      withArrow
      shadow="md"
      withinPortal
      trapFocus={false}
    >
      <Popover.Target>
        <UnstyledButton
          onClick={() => setOpened(!opened)}
          aria-expanded={opened}
          aria-label={`Hälytykset: ${state.open.length} avoinna`}
          title={`Hälytykset: ${state.open.length} avoinna`}
        >
          <Group gap={4} wrap="nowrap">
            <IconBellRinging
              size={18}
              stroke={1.5}
              style={{ color: state.worst ? `var(--mantine-color-${colour}-5)` : undefined }}
            />
            {state.open.length > 0 && (
              <Badge color={colour} size="sm" circle>
                {state.open.length}
              </Badge>
            )}
          </Group>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Stack gap="xs" style={{ maxHeight: "60vh" }}>
          <Text fz="xs" fw={700}>
            Hälytykset
          </Text>
          <AlertsList state={state} />
          <AlertsFooter state={state} lookback={LOOKBACK} />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};
