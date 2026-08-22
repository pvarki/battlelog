import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  TagsInput,
  TextInput,
} from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { type FeedColumn, type FeedConfig, FIELD_LABEL, FIELDS, labelFor } from "./widget.ts";

const SOURCE_OPTIONS = [
  ...FIELDS.map((f) => ({ value: f, label: FIELD_LABEL[f] })),
  { value: "data", label: "Data field" },
];

const FeedConfigForm = ({ config, onChange }: WidgetConfigProps<FeedConfig>) => {
  const setColumns = (columns: FeedColumn[]) => onChange({ ...config, columns });
  const setColumn = (id: string, patch: Partial<FeedColumn>) =>
    setColumns(config.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
      <TagsInput
        label="Types"
        description="Only these event types; empty = all"
        value={config.types ?? []}
        onChange={(v) => onChange({ ...config, types: v.length ? v : undefined })}
      />
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
            search: e.currentTarget.value.trim() ? e.currentTarget.value : undefined,
          })
        }
      />
      <TextInput
        label="Created by"
        value={config.createdBy ?? ""}
        onChange={(e) =>
          onChange({
            ...config,
            createdBy: e.currentTarget.value.trim() ? e.currentTarget.value : undefined,
          })
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

      {config.columns.map((col) => (
        <Paper key={col.id} withBorder p="xs">
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
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove ${labelFor(col)}`}
                disabled={config.columns.length === 1}
                onClick={() => setColumns(config.columns.filter((c) => c.id !== col.id))}
              >
                ✕
              </ActionIcon>
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
          </Stack>
        </Paper>
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
