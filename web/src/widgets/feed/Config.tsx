import {
  ActionIcon,
  Button,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  Stack,
  TagsInput,
  TextInput,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ingestApi } from "../../api.ts";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
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

type IngestName = { id: string; kind: string; name: string };

const FeedConfigForm = ({ config, onChange }: WidgetConfigProps<FeedConfig>) => {
  // Names only — the full ingest list is admin-only, and picking a setup does
  // not need its config.
  const [setups, setSetups] = useState<IngestName[]>([]);
  useEffect(() => {
    void (async () => {
      const res = await ingestApi.ingest.names.$get();
      if (res.ok) setSetups((await res.json()) as IngestName[]);
    })().catch(() => {
      // No setups offered; the field just stays empty, which means "all sources"
    });
  }, []);

  const setColumns = (columns: FeedColumn[]) => onChange({ ...config, columns });
  const setColumn = (id: string, patch: Partial<FeedColumn>) =>
    setColumns(config.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
      <MultiSelect
        label="Ingest setups"
        description={
          setups.length
            ? "Only events from these setups; empty = every source"
            : "No ingest setups configured yet"
        }
        data={setups.map((s) => ({ value: s.id, label: `${s.name} (${s.kind})` }))}
        value={config.ingestSources ?? []}
        onChange={(v) => onChange({ ...config, ingestSources: v.length ? v : undefined })}
        searchable
        clearable
        disabled={!setups.length}
      />
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
                color="gray"
                aria-label={`Remove ${labelFor(col)}`}
                disabled={config.columns.length === 1}
                onClick={() => setColumns(config.columns.filter((c) => c.id !== col.id))}
              >
                <IconX size={18} stroke={1.5} />
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
