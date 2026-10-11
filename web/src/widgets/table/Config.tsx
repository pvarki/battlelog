import { Checkbox, Group, NumberInput, Stack } from "@mantine/core";
import { EventPicker } from "../../dashboard/EventPicker.tsx";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { type TableConfig, tableColumnCount, tableColumns, tableRowCount } from "./widget.ts";

const TableConfigForm = ({ config, onChange }: WidgetConfigProps<TableConfig>) => {
  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />

      <EventPicker
        eventType="table"
        description="The table follows this event's version chain. Pick another table widget's table to share its cells, or start fresh to create a new table on the next edit."
        value={config.eventId}
        onChange={(eventId) => onChange({ ...config, eventId })}
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
