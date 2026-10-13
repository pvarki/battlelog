import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { deleteEvent } from "../commands.ts";
import type { CotEvent, TakItem } from "../cot.ts";
import { labelOf } from "../items.ts";

type Props = {
  item: TakItem;
  /** Live mode sends to TAK; with a plan active the delete is staged in it. */
  onSubmit: (event: CotEvent) => void;
};

/** Removes the item from every TAK client's map, as ATAK's delete does, after a confirmation. */
export const DeleteItem = ({ item, onSubmit }: Props) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="light"
        color="danger"
        size="xs"
        leftSection={<IconTrash size={14} />}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
      <Modal
        opened={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${labelOf(item)}?`}
        centered
      >
        <Stack gap="sm">
          <Text fz="sm">
            It is removed from the map of every TAK user. With a plan active, that happens when the
            plan is published.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setConfirming(false)} data-autofocus>
              Cancel
            </Button>
            <Button
              size="xs"
              color="danger"
              onClick={() => {
                setConfirming(false);
                onSubmit(deleteEvent(item));
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
