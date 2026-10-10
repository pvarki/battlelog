import { Checkbox, Group, NumberInput, Stack, TextInput } from "@mantine/core";
import { useState } from "react";
import { z } from "zod";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { type TableConfig, tableColumnCount, tableColumns, tableRowCount } from "./widget.ts";

const uuidSchema = z.string().uuid();
const isUuid = (value: string) => uuidSchema.safeParse(value).success;

const TableConfigForm = ({ config, onChange }: WidgetConfigProps<TableConfig>) => {
  const [idDraft, setIdDraft] = useState(config.eventId ?? "");
  const idValid = idDraft.trim() === "" || isUuid(idDraft.trim());

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />

      <TextInput
        label="Event id"
        description="The table follows this event's version chain. Paste another table widget's id to share its cells, or clear to start a fresh table on the next edit."
        placeholder="Created on first save"
        value={idDraft}
        error={idValid ? undefined : "Not a valid event id"}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setIdDraft(value);
          const trimmed = value.trim();
          if (trimmed === "") onChange({ ...config, eventId: undefined });
          else if (isUuid(trimmed)) onChange({ ...config, eventId: trimmed });
        }}
      />

      <Group grow align="flex-start">
        <NumberInput
          label="Columns"
          min={1}
          max={26}
          value={tableColumnCount(config.columnCount)}
          onChange={(value) => {
            if (typeof value === "number") {
              const columnCount = tableColumnCount(value);
              onChange({ ...config, columnCount, columns: tableColumns(columnCount) });
            }
          }}
        />
        <NumberInput
          label="Rows"
          min={1}
          max={500}
          value={tableRowCount(config.rowCount)}
          onChange={(value) => {
            if (typeof value === "number") {
              onChange({ ...config, rowCount: tableRowCount(value) });
            }
          }}
        />
      </Group>

      <Checkbox
        label="Show row numbers"
        checked={!config.hideRowNumbers}
        onChange={(event) => onChange({ ...config, hideRowNumbers: !event.currentTarget.checked })}
      />
      <Checkbox
        label="Show column headers"
        checked={!config.hideColumnHeaders}
        onChange={(event) =>
          onChange({ ...config, hideColumnHeaders: !event.currentTarget.checked })
        }
      />
    </Stack>
  );
};

export default TableConfigForm;
