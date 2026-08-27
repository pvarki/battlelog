import { Center, Group, Loader, Popover, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconBellRinging, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { SEVERITY_COLOUR } from "../../alerts.ts";
import { AlertsFooter, AlertsList, useAlerts, useAutoUnfold } from "../../alerts-panel.tsx";
import { useIsMobile } from "../../dashboard/mobile.ts";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import type { AlertsConfig } from "./widget.ts";

/**
 * Alerts as a board tile.
 *
 * The header's bell (see AlertsBell) is where alerts normally live, and it costs
 * no board space. This widget is for the case the bell cannot serve: a wall
 * display where the list should be permanently readable rather than behind a
 * control nobody is standing next to.
 */
const AlertsView = ({ config }: WidgetViewProps<AlertsConfig>) => {
  // On a phone this widget is one tab with the whole screen to itself, so folding
  // it would hide the list behind a tap for nothing.
  const isMobile = useIsMobile();
  const state = useAlerts(config.lookback);
  const [opened, setOpened] = useAutoUnfold(
    state.ready,
    state.open.map((r) => r.key),
  );

  if (!state.ready) {
    return (
      <Center h="100%">
        <Loader size="sm" />
      </Center>
    );
  }

  if (isMobile) {
    return (
      <Stack h="100%" gap="xs" p="xs">
        <AlertsList state={state} />
        <AlertsFooter state={state} lookback={config.lookback} />
      </Stack>
    );
  }

  const colour = SEVERITY_COLOUR[state.worst?.alert.severity ?? "info"];
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
          onClick={() => setOpened(!opened)}
          h="100%"
          w="100%"
          // The bar must stay clickable however short the tile is made.
          mih={32}
          px="xs"
          aria-expanded={opened}
          aria-label={`Hälytykset: ${state.open.length} avoinna`}
        >
          <Group gap="xs" wrap="nowrap" h="100%">
            <IconBellRinging
              size={18}
              stroke={1.5}
              style={{
                flexShrink: 0,
                color: state.worst ? `var(--mantine-color-${colour}-5)` : undefined,
              }}
            />
            {state.open.length > 0 ? (
              <>
                {/* Fixed width, so the bar does not reflow as the count and the
                    worst severity change under it. */}
                <Text fz="xs" fw={700} c={`${colour}.4`} w={72} style={{ flexShrink: 0 }}>
                  {state.open.length} avoinna
                </Text>
                <Text fz="xs" c="dimmed" truncate>
                  {state.worst?.event.header}
                </Text>
              </>
            ) : (
              <Text fz="xs" c="dimmed" truncate>
                Ei avoimia hälytyksiä · {state.raised.length} kuitattu
              </Text>
            )}
            <Chevron size={14} stroke={2} style={{ flexShrink: 0, marginLeft: "auto" }} />
          </Group>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Stack gap="xs" style={{ maxHeight: "50vh" }}>
          <AlertsList state={state} />
          <AlertsFooter state={state} lookback={config.lookback} />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
};

export default AlertsView;
