import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconX } from "@tabler/icons-react";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import type { FieldSuggestion } from "../../event-binding/detect.ts";
import {
  FieldInput,
  OptionsEditor,
  QueryEditor,
  useFieldSuggestions,
} from "../../event-binding/editors.tsx";
import { FilterInput } from "./FilterInput.tsx";
import { isFilterActive } from "./table.ts";
import {
  BUILTIN_SOURCES,
  columnLabel,
  type EventTableConfig,
  SOURCE_LABEL,
  type TableColumn,
} from "./widget.ts";

const KIND_OPTIONS = [
  { label: "Text", value: "text" },
  { label: "Count", value: "count" },
  { label: "Choice", value: "choice" },
  { label: "Boolean", value: "boolean" },
];

const SOURCE_OPTIONS = (["data", ...BUILTIN_SOURCES] as const).map((value) => ({
  value,
  label: SOURCE_LABEL[value],
}));

/** A picked suggestion fills what the user hasn't set yet: label, and kind/options while still default. */
const fromSuggestion = (col: TableColumn, s: FieldSuggestion): Partial<TableColumn> => ({
  field: s.path,
  ...(col.label.trim() ? {} : { label: s.path.split(".").at(-1) ?? s.path }),
  ...(col.kind === "text" && col.options.length === 0
    ? { kind: s.kind, options: s.options.map((value) => ({ value, color: "gray" as const })) }
    : {}),
});

const EventTableConfigForm = ({ config, onChange }: WidgetConfigProps<EventTableConfig>) => {
  const suggestions = useFieldSuggestions(config);
  const setColumns = (columns: TableColumn[]) => onChange({ ...config, columns });
  const setColumn = (id: string, patch: Partial<TableColumn>) =>
    setColumns(config.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...config.columns];
    const [col] = next.splice(index, 1);
    if (col) next.splice(index + by, 0, col);
    setColumns(next);
  };

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
      <QueryEditor query={config} onChange={onChange} />
      <Group wrap="nowrap" align="flex-end">
        <Select
          label="Default order"
          size="xs"
          style={{ flex: 1 }}
          data={[
            { value: "header", label: "Header" },
            { value: "created", label: "Created" },
            ...config.columns.map((c) => ({ value: c.id, label: columnLabel(c) })),
          ]}
          value={config.sortBy}
          onChange={(sortBy) => sortBy && onChange({ ...config, sortBy })}
        />
        <SegmentedControl
          size="xs"
          data={[
            { label: "Asc", value: "asc" },
            { label: "Desc", value: "desc" },
          ]}
          value={config.sortDir}
          onChange={(dir) => onChange({ ...config, sortDir: dir as EventTableConfig["sortDir"] })}
        />
        <NumberInput
          label="Max rows"
          size="xs"
          w={90}
          min={1}
          max={500}
          value={config.rowLimit}
          onChange={(n) => typeof n === "number" && onChange({ ...config, rowLimit: n })}
        />
      </Group>

      <Group>
        <Switch
          size="xs"
          label="Allow sorting by column"
          checked={config.allowSorting}
          onChange={(e) => onChange({ ...config, allowSorting: e.currentTarget.checked })}
        />
        <Switch
          size="xs"
          label="Allow filtering"
          description="Off: default filters still apply, as a fixed view"
          checked={config.allowFiltering}
          onChange={(e) => onChange({ ...config, allowFiltering: e.currentTarget.checked })}
        />
      </Group>

      <Text fz="sm" fw={600}>
        Columns
      </Text>
      {config.columns.map((col, index) => (
        <Paper key={col.id} withBorder p="xs">
          <Stack gap={4}>
            <Group wrap="nowrap" align="flex-end">
              <Select
                label="Shows"
                size="xs"
                w={130}
                data={SOURCE_OPTIONS}
                value={col.source}
                onChange={(source) =>
                  source &&
                  setColumn(col.id, { source: source as TableColumn["source"], editable: false })
                }
              />
              <TextInput
                label="Label"
                size="xs"
                style={{ flex: 1 }}
                placeholder={columnLabel(col)}
                value={col.label}
                onChange={(e) => setColumn(col.id, { label: e.currentTarget.value })}
              />
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Move column earlier"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <IconArrowUp size={16} stroke={1.5} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Move column later"
                disabled={index === config.columns.length - 1}
                onClick={() => move(index, 1)}
              >
                <IconArrowDown size={16} stroke={1.5} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Remove ${columnLabel(col)}`}
                onClick={() => setColumns(config.columns.filter((c) => c.id !== col.id))}
              >
                <IconX size={18} stroke={1.5} />
              </ActionIcon>
            </Group>
            {col.source === "data" && (
              <>
                <FieldInput
                  label="Field"
                  description="Suggestions come from the events the query matches now"
                  value={col.field}
                  suggestions={suggestions}
                  onChange={(field) => setColumn(col.id, { field })}
                  onPick={(s) => setColumn(col.id, fromSuggestion(col, s))}
                />
                <SegmentedControl
                  size="xs"
                  data={KIND_OPTIONS}
                  value={col.kind}
                  onChange={(kind) => setColumn(col.id, { kind: kind as TableColumn["kind"] })}
                />
              </>
            )}
            {(col.source === "data" || col.source === "header") && (
              <Switch
                size="xs"
                label="Allow editing in the table"
                checked={col.editable}
                onChange={(e) => setColumn(col.id, { editable: e.currentTarget.checked })}
              />
            )}
            {col.source === "data" && col.kind === "choice" && (
              <OptionsEditor
                options={col.options}
                onChange={(options) => setColumn(col.id, { options })}
              />
            )}
            <Stack gap={2}>
              <Text fz="xs" fw={500}>
                Default filter
              </Text>
              <FilterInput
                column={col}
                seen={[]}
                filter={col.defaultFilter ?? {}}
                onChange={(next) =>
                  setColumn(col.id, { defaultFilter: isFilterActive(next) ? next : undefined })
                }
              />
            </Stack>
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
              label: "",
              source: "data",
              field: "",
              kind: "text",
              options: [],
              editable: false,
            },
          ])
        }
      >
        Add column
      </Button>
    </Stack>
  );
};

export default EventTableConfigForm;
