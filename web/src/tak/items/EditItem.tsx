import { Button, Group, Stack, Textarea, TextInput } from "@mantine/core";
import { useState } from "react";
import { editEvent, publish, setCallsign, setRemarks } from "../commands.ts";
import type { TakItem } from "../cot.ts";
import { labelOf } from "../items.ts";

type Props = { item: TakItem; onDone: () => void };

/** Name and remarks of an existing item, sent to TAK on save (Live mode: everyone sees it at once). */
export const EditItem = ({ item, onDone }: Props) => {
  const [name, setName] = useState(labelOf(item));
  const [remarks, setRemarksText] = useState(item.remarks ?? "");
  const save = () => {
    void publish(
      editEvent(item, (detail) => {
        if (name.trim() && name !== labelOf(item)) setCallsign(detail, name.trim());
        if (remarks !== (item.remarks ?? "")) setRemarks(detail, remarks);
      }),
    );
    onDone();
  };
  return (
    <Stack
      gap="xs"
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <TextInput
        size="xs"
        label="Name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <Textarea
        size="xs"
        label="Remarks"
        autosize
        minRows={2}
        maxRows={8}
        value={remarks}
        onChange={(e) => setRemarksText(e.currentTarget.value)}
      />
      <Group gap="xs" justify="flex-end">
        <Button size="xs" variant="default" onClick={onDone}>
          Cancel
        </Button>
        <Button size="xs" type="submit" disabled={!name.trim()}>
          Save to TAK
        </Button>
      </Group>
    </Stack>
  );
};
