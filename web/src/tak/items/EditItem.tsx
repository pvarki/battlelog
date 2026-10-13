import { Button, Group, Select, Stack, Textarea, TextInput } from "@mantine/core";
import { useState } from "react";
import { editEvent, setCallsign, setRemarks, setSymbol } from "../commands.ts";
import type { CotEvent, TakItem } from "../cot.ts";
import {
  labelOf,
  sidcOf,
  UNIT_STATUSES,
  type UnitStatus,
  unitStatusOf,
  withUnitStatus,
} from "../items.ts";

type Props = {
  item: TakItem;
  /** Preselected status, e.g. from "Mark destroyed". */
  status?: UnitStatus;
  /** Live mode sends to TAK; with a plan active the change becomes a draft. */
  onSubmit: (event: CotEvent) => void;
  submitLabel: string;
  onDone: () => void;
};

/**
 * Name, remarks and (for units) 2525 status of an existing item, sent to TAK
 * on save. Live mode: everyone sees the change at once.
 */
export const EditItem = ({ item, status: preset, onSubmit, submitLabel, onDone }: Props) => {
  const sidc = item.type.startsWith("a-") ? sidcOf(item) : undefined;
  const original = item.callsign ?? item.uid;
  const [name, setName] = useState(original);
  const [remarks, setRemarksText] = useState(item.remarks ?? "");
  const current = sidc ? unitStatusOf(sidc) : undefined;
  const [status, setStatus] = useState<UnitStatus | undefined>(preset ?? current);
  const save = () => {
    onSubmit(
      editEvent(item, (detail) => {
        if (name.trim() && name !== original) setCallsign(detail, name.trim());
        if (remarks !== (item.remarks ?? "")) setRemarks(detail, remarks);
        if (sidc && status && status !== current) setSymbol(detail, withUnitStatus(sidc, status));
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
      {sidc && (
        <Select
          size="xs"
          label="Status"
          data={Object.entries(UNIT_STATUSES).map(([value, s]) => ({ value, label: s.label }))}
          value={status ?? null}
          onChange={(value) => value && setStatus(value as UnitStatus)}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
      )}
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
          {submitLabel}
        </Button>
      </Group>
    </Stack>
  );
};
