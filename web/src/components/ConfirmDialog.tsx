import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";

type Props = {
  opened: boolean;
  /** A question naming what happens, e.g. `Delete "Ops"?` */
  title: string;
  /** What follows from it, especially what can't be undone. */
  children: ReactNode;
  /** The verb on the button, e.g. "Delete"; never "OK". */
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

/** The app's one confirmation for destructive actions; Cancel takes the focus. */
export const ConfirmDialog = ({
  opened,
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
}: Props) => (
  <Modal opened={opened} onClose={onClose} title={title} centered>
    <Stack gap="sm">
      <Text fz="sm">{children}</Text>
      <Group justify="flex-end" gap="xs">
        <Button size="xs" variant="default" onClick={onClose} data-autofocus>
          Cancel
        </Button>
        <Button
          size="xs"
          color="danger"
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </Group>
    </Stack>
  </Modal>
);
