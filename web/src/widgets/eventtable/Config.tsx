import {
  Button,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { ItemCard, moveItem } from "../../dashboard/ItemCard.tsx";
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

const RESERVED_SORT_KEYS = ["header", "created"];

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
            // A column id equal to a reserved key (older default configs used
            // "header") would be a duplicate option, which Mantine rejects.
            ...config.columns
              .filter((c) => !RESERVED_SORT_KEYS.includes(c.id))
              .map((c) => ({ value: c.id, label: columnLabel(c) })),
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
        <Switch
          size="xs"
          label="Follow the map selection"
          description="While a TAK item is selected, only events linked to it"
          checked={config.followTakSelection ?? false}
          onChange={(e) =>
            onChange({ ...config, followTakSelection: e.currentTarget.checked || undefined })
          }
        />
      </Group>

      <Text fz="sm" fw={600}>
        Columns
      </Text>
      {config.columns.map((col, index) => (
        <ItemCard
          key={col.id}
          name={columnLabel(col)}
          onRemove={() => setColumns(config.columns.filter((c) => c.id !== col.id))}
          move={{
            index,
            count: config.columns.length,
            onMove: (by) => setColumns(moveItem(config.columns, index, by)),
          }}
        >
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
        </ItemCard>
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
