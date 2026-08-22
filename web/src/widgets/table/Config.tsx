import { Button, Checkbox, Group, NumberInput, Stack } from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import {
  DEFAULT_COLUMN_COUNT,
  DEFAULT_ROW_COUNT,
  type TableConfig,
  tableColumnCount,
  tableColumns,
  tableRowCount,
} from "./widget.ts";

const TableConfigForm = ({ config, onChange }: WidgetConfigProps<TableConfig>) => {
  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />

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

      <Button
        variant="light"
        onClick={() =>
          onChange({
            ...config,
            columnCount: DEFAULT_COLUMN_COUNT,
            columns: tableColumns(DEFAULT_COLUMN_COUNT),
            rowCount: DEFAULT_ROW_COUNT,
          })
        }
      >
        Reset table size
      </Button>
    </Stack>
  );
};

export default TableConfigForm;
