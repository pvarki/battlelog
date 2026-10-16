import { Button, Group, Text } from "@mantine/core";
import { IconArrowsMove, IconTrash, IconX } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";

type Props = {
  count: number;
  /** How many of the selected items this user may move and delete. */
  movable: number;
  deletable: number;
  moving: boolean;
  onMove: () => void;
  onCancelMove: () => void;
  onDelete: () => void;
  onClear: () => void;
  /** The plan changes go into; undefined = straight to TAK. */
  planName: string | undefined;
  children?: ReactNode;
};

const hintFor = ({ count, movable, deletable, moving }: Props) => {
  if (moving) return "Click where the middle of the group goes.";
  const locked = count - Math.min(movable, deletable);
  const lockedNote = locked > 0 ? ` ${locked} of them can't be changed from here.` : "";
  return `Shift-click, Shift-drag or the lasso (Tools) adds or removes items.${lockedNote}`;
};

/** Several items picked together, to move or delete in one go. */
export const SelectionPanel = (props: Props) => {
  const { count, movable, deletable, moving, onMove, onCancelMove, onDelete, onClear, planName } =
    props;
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Group gap={4} wrap="nowrap" justify="space-between">
        <Text fz="xs" fw={600} px={6}>
          {count} selected
        </Text>
        <Group gap={4} wrap="nowrap">
          {moving ? (
            <Button size="compact-xs" variant="subtle" color="gray" onClick={onCancelMove}>
              Cancel move (Esc)
            </Button>
          ) : (
            <>
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<IconArrowsMove size={14} />}
                disabled={movable === 0}
                onClick={onMove}
              >
                Move {movable}
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                color="danger"
                leftSection={<IconTrash size={14} />}
                disabled={deletable === 0}
                onClick={() => setConfirming(true)}
              >
                Delete {deletable}
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                leftSection={<IconX size={14} />}
                onClick={onClear}
              >
                Clear (Esc)
              </Button>
            </>
          )}
          {props.children}
        </Group>
      </Group>
      <Text fz="xs" c="dimmed" px={6} pt={2}>
        {hintFor(props)}
      </Text>
      <ConfirmDialog
        opened={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${deletable} items?`}
        confirmLabel="Delete"
        onConfirm={onDelete}
      >
        {planName
          ? `They are removed from the map of every TAK user when plan ${planName} is published.`
          : "They are removed from the map of every TAK user."}{" "}
        Undo sends them back.
      </ConfirmDialog>
    </>
  );
};
