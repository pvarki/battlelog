import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { optionalText } from "../../dashboard/form-utils.ts";
import { ItemCard, moveItem } from "../../dashboard/ItemCard.tsx";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import type { DataFilter } from "../../event-binding/filter.ts";
import {
  columnWidth,
  type FeedColumn,
  type FeedConfig,
  FIELD_LABEL,
  FIELDS,
  labelFor,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} from "./widget.ts";

const SOURCE_OPTIONS = [
  ...FIELDS.map((f) => ({ value: f, label: FIELD_LABEL[f] })),
  { value: "data", label: "Data field" },
];

const FeedConfigForm = ({ config, onChange }: WidgetConfigProps<FeedConfig>) => {
  const setColumns = (columns: FeedColumn[]) => onChange({ ...config, columns });
  const setColumn = (id: string, patch: Partial<FeedColumn>) =>
    setColumns(config.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const dataFilters = config.dataFilters ?? [];
  const setDataFilters = (next: DataFilter[]) =>
    onChange({ ...config, dataFilters: next.length ? next : undefined });
  const setDataFilter = (id: string, patch: Partial<DataFilter>) =>
    setDataFilters(dataFilters.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
      <TagsInput
        label="Types"
        description="Only these event types; empty = all"
        value={config.types ?? []}
        onChange={(v) => onChange({ ...config, types: v.length ? v : undefined })}
      />
      {config.types?.length ? (
        <Stack gap="xs">
          {dataFilters.map((f) => (
            <Group key={f.id} wrap="nowrap" align="flex-end">
              <TextInput
                label="Data path"
                size="xs"
                style={{ flex: 1 }}
                placeholder="e.g. status"
                maxLength={200}
                value={f.path}
                onChange={(e) => setDataFilter(f.id, { path: e.currentTarget.value })}
              />
              <TextInput
                label="Equals"
                size="xs"
                style={{ flex: 1 }}
                placeholder="e.g. inside"
                maxLength={200}
                value={f.value}
                onChange={(e) => setDataFilter(f.id, { value: e.currentTarget.value })}
              />
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label="Remove data filter"
                onClick={() => setDataFilters(dataFilters.filter((x) => x.id !== f.id))}
              >
                <IconX size={18} stroke={1.5} />
              </ActionIcon>
            </Group>
          ))}
          <Button
            size="compact-xs"
            variant="light"
            disabled={dataFilters.length >= 10}
            onClick={() =>
              setDataFilters([...dataFilters, { id: crypto.randomUUID(), path: "", value: "" }])
            }
          >
            + Data filter
          </Button>
        </Stack>
      ) : (
        dataFilters.length > 0 && (
          <Text fz="xs" c="dimmed">
            Data filters are paused until at least one type is set.
          </Text>
        )
      )}
      <TagsInput
        label="Tags"
        description="Events carrying any of these tags; empty = all"
        value={config.tags ?? []}
        onChange={(v) => onChange({ ...config, tags: v.length ? v : undefined })}
      />
      <TextInput
        label="Search"
        description="Header contains"
        value={config.search ?? ""}
        onChange={(e) =>
          onChange({
            ...config,
            search: optionalText(e.currentTarget.value),
          })
        }
      />
      <TextInput
        label="Created by"
        value={config.createdBy ?? ""}
        onChange={(e) =>
          onChange({
            ...config,
            createdBy: optionalText(e.currentTarget.value),
          })
        }
      />
      <Switch
        label="Follow the map selection"
        description="While a TAK item is selected, only events linked to it"
        checked={config.followTakSelection ?? false}
        onChange={(e) =>
          onChange({ ...config, followTakSelection: e.currentTarget.checked || undefined })
        }
      />
      <NumberInput
        label="Rows"
        min={1}
        max={100}
        value={config.rows}
        onChange={(v) => {
          if (typeof v === "number") onChange({ ...config, rows: v });
        }}
      />

      {config.columns.map((col, index) => (
        <ItemCard
          key={col.id}
          name={labelFor(col)}
          removeDisabled={config.columns.length === 1}
          onRemove={() => setColumns(config.columns.filter((c) => c.id !== col.id))}
          move={{
            index,
            count: config.columns.length,
            onMove: (by) => setColumns(moveItem(config.columns, index, by)),
          }}
        >
          <Stack gap="xs">
            <Group wrap="nowrap" align="flex-end">
              <TextInput
                label="Label"
                size="xs"
                style={{ flex: 1 }}
                placeholder={labelFor({ ...col, label: "" })}
                value={col.label}
                onChange={(e) => setColumn(col.id, { label: e.currentTarget.value })}
              />
              <Select
                label="Column"
                size="xs"
                data={SOURCE_OPTIONS}
                allowDeselect={false}
                value={col.source}
                onChange={(source) => {
                  if (source) setColumn(col.id, { source: source as FeedColumn["source"] });
                }}
              />
            </Group>
            {col.source === "data" && (
              <TextInput
                label="Data path"
                size="xs"
                placeholder="e.g. casualties.total"
                description="Dot path into the event's data; blank cells when missing"
                value={col.dataPath}
                onChange={(e) => setColumn(col.id, { dataPath: e.currentTarget.value })}
              />
            )}
            <NumberInput
              label="Width"
              size="xs"
              min={MIN_COLUMN_WIDTH}
              max={MAX_COLUMN_WIDTH}
              value={columnWidth(col)}
              onChange={(width) => {
                if (typeof width === "number") setColumn(col.id, { width });
              }}
            />
          </Stack>
        </ItemCard>
      ))}

      <Button
        variant="light"
        disabled={config.columns.length >= 20}
        onClick={() =>
          setColumns([
            ...config.columns,
            { id: crypto.randomUUID(), label: "", source: "header", dataPath: "" },
          ])
        }
      >
        Add column
      </Button>
    </Stack>
  );
};

export default FeedConfigForm;
