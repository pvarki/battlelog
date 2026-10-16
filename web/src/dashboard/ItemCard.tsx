import { ActionIcon, Group, Paper, Text } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

export const moveItem = <T,>(items: T[], index: number, by: -1 | 1): T[] => {
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(index + by, 0, item);
  return next;
};

export type ItemActionsProps = {
  /** Names the item in the buttons' aria-labels. */
  name: string;
  onRemove: () => void;
  removeDisabled?: boolean;
  /** Omit to hide the move buttons. */
  move?: { index: number; count: number; onMove: (by: -1 | 1) => void };
};

export const ItemActions = ({ name, onRemove, removeDisabled, move }: ItemActionsProps) => (
  <Group gap={2} wrap="nowrap" ml="auto">
    {move && (
      <>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={`Move ${name} up`}
          disabled={move.index === 0}
          onClick={() => move.onMove(-1)}
        >
          <IconArrowUp size={16} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label={`Move ${name} down`}
          disabled={move.index === move.count - 1}
          onClick={() => move.onMove(1)}
        >
          <IconArrowDown size={16} />
        </ActionIcon>
      </>
    )}
    <ActionIcon
      variant="subtle"
      color="gray"
      size="sm"
      aria-label={`Remove ${name}`}
      disabled={removeDisabled}
      onClick={onRemove}
    >
      <IconX size={16} />
    </ActionIcon>
  </Group>
);

/** One entry of a repeated list in a widget settings form. Add buttons below the list are `variant="default"` `size="xs"`, labelled "Add <thing>". */
export const ItemCard = ({
  label,
  children,
  ...actions
}: ItemActionsProps & { label?: ReactNode; children: ReactNode }) => (
  <Paper withBorder p="xs">
    <Group wrap="nowrap" gap="xs" mb={4}>
      {label && (
        <Text fz="xs" c="dimmed" truncate>
          {label}
        </Text>
      )}
      <ItemActions {...actions} />
    </Group>
    {children}
  </Paper>
);
