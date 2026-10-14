import { Button } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
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
      <ConfirmDialog
        opened={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${labelOf(item)}?`}
        confirmLabel="Delete"
        onConfirm={() => onSubmit(deleteEvent(item))}
      >
        It is removed from the map of every TAK user. With a plan active, that happens when the plan
        is published.
      </ConfirmDialog>
    </>
  );
};
