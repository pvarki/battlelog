import { Button, Stack, Text } from "@mantine/core";

export type PlaceholderAction = { label: string; onClick: () => void };

/**
 * The app's one empty/failure state: what is missing, why, and — wherever one
 * exists — the button that fixes it. An empty screen is where an untrained user
 * needs the most help, so "nothing here" is never allowed to be the whole
 * message. Fills its container; wrap it for vertical room in page flow.
 */
export const Placeholder = ({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: PlaceholderAction;
}) => (
  <Stack align="center" justify="center" h="100%" gap={6} p="sm" ta="center">
    <Text fw={600}>{title}</Text>
    <Text c="dimmed" fz="xs">
      {detail}
    </Text>
    {action && (
      <Button size="compact-xs" variant="light" onClick={action.onClick}>
        {action.label}
      </Button>
    )}
  </Stack>
);
