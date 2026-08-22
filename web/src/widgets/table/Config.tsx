import {
  ActionIcon,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  TextInput,
} from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { columnKeys, formulaError } from "./formula.ts";
import type { TableColumn, TableConfig } from "./widget.ts";

const TableConfigForm = ({ config, onChange }: WidgetConfigProps<TableConfig>) => {
  const setColumns = (columns: TableColumn[]) => onChange({ ...config, columns });
  const setColumn = (id: string, patch: Partial<TableColumn>) =>
    setColumns(config.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />

      {config.columns.map((col) => (
        <Paper key={col.id} withBorder p="xs">
          <Stack gap="xs">
            <Group wrap="nowrap" align="flex-end">
              <TextInput
                label="Label"
                size="xs"
                style={{ flex: 1 }}
                value={col.label}
                onChange={(e) => setColumn(col.id, { label: e.currentTarget.value })}
              />
              <SegmentedControl
                size="xs"
                data={[
                  { label: "Text", value: "text" },
                  { label: "Number", value: "number" },
                  { label: "Formula", value: "formula" },
                ]}
                value={col.kind}
                onChange={(kind) => setColumn(col.id, { kind: kind as TableColumn["kind"] })}
              />
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove ${col.label}`}
                onClick={() => setColumns(config.columns.filter((c) => c.id !== col.id))}
              >
                ✕
              </ActionIcon>
            </Group>

            {col.kind === "formula" && (
              <TextInput
                label="Formula"
                size="xs"
                placeholder="e.g. qty * unit_price"
                description={`Number columns available: ${
                  [...columnKeys(config.columns).values()].join(", ") || "none yet"
                }`}
                value={col.formula ?? ""}
                error={col.formula ? formulaError(col.formula, config.columns) : undefined}
                onChange={(e) => setColumn(col.id, { formula: e.currentTarget.value || undefined })}
              />
            )}
          </Stack>
        </Paper>
      ))}

      <Button
        variant="light"
        onClick={() =>
          setColumns([
            ...config.columns,
            {
              id: crypto.randomUUID(),
              label: `Column ${config.columns.length + 1}`,
              kind: "text",
              formula: undefined,
            },
          ])
        }
      >
        Add column
      </Button>
    </Stack>
  );
};

export default TableConfigForm;
