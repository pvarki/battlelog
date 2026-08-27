import { Badge, Box, Drawer, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconBellRinging } from "@tabler/icons-react";
import { useState } from "react";
import { SEVERITY_COLOUR } from "./alerts.ts";
import { AlertsFooter, AlertsList, type AlertsState } from "./alerts-panel.tsx";

/**
 * Alerts in the phone's bottom bar.
 *
 * The header's bell drops a popover, which on a phone is wider than the screen —
 * the acknowledge column ended up outside the viewport. Here the list is a
 * bottom drawer instead: full width, so nothing can be pushed off the edge.
 *
 * ponytail: a new alert does NOT switch the screen to this. On a phone one widget
 * has the whole screen, and taking it over would unmount whatever is there — the
 * entry form holds a half-typed report in component state, and losing that to an
 * alert would be worse than the alert being one tap away. The count badge is the
 * signal; the tap is the operator's.
 */
export const AlertsBarButton = ({ state, lookback }: { state: AlertsState; lookback: number }) => {
  const [opened, setOpened] = useState(false);
  const colour = SEVERITY_COLOUR[state.worst?.alert.severity ?? "info"];
  const open = state.open.length;

  return (
    <>
      <UnstyledButton
        onClick={() => setOpened(true)}
        aria-label={`Hälytykset: ${open} avoinna`}
        c={open > 0 ? `${colour}.4` : "dimmed"}
        style={{ flex: 1, height: "100%", minWidth: 0 }}
      >
        <Stack align="center" justify="center" gap={2} h="100%" px={4}>
          <Box style={{ position: "relative", lineHeight: 0 }}>
            <IconBellRinging size={22} stroke={1.5} />
            {open > 0 && (
              <Badge
                color={colour}
                size="xs"
                circle
                style={{ position: "absolute", top: -6, right: -10 }}
              >
                {open}
              </Badge>
            )}
          </Box>
          <Text fz={10} truncate>
            Hälytykset
          </Text>
        </Stack>
      </UnstyledButton>
      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        position="bottom"
        title="Hälytykset"
        size="70%"
      >
        <Stack gap="xs" h="100%">
          <AlertsList state={state} />
          <AlertsFooter state={state} lookback={lookback} />
        </Stack>
      </Drawer>
    </>
  );
};
