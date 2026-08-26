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
  Text,
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
  type FeedView,
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

/** The column list editor, used for the widget's own columns and for each view's. */
const ColumnsEditor = ({
  columns,
  onChange,
}: {
  columns: FeedColumn[];
  onChange: (columns: FeedColumn[]) => void;
}) => {
  const setColumn = (id: string, patch: Partial<FeedColumn>) =>
    onChange(columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <>
      {columns.map((col) => (
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
                disabled={columns.length === 1}
                onClick={() => onChange(columns.filter((c) => c.id !== col.id))}
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
        size="xs"
        disabled={columns.length >= 20}
        onClick={() =>
          onChange([
            ...columns,
            { id: crypto.randomUUID(), label: "", source: "header", dataPath: "" },
          ])
        }
      >
        Add column
      </Button>
    </>
  );
};

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

  const views = config.views ?? [];
  const setColumns = (columns: FeedColumn[]) => onChange({ ...config, columns });
  const setViews = (next: FeedView[]) =>
    onChange({ ...config, views: next.length ? next : undefined });
  const setView = (id: string, patch: Partial<FeedView>) =>
    setViews(views.map((v) => (v.id === id ? { ...v, ...patch } : v)));

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
        description="Header contains, case-insensitive"
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
        description="Exact author match"
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

      <Text fz="sm" fw={600} mt="sm">
        Views
      </Text>
      <Text fz="xs" c="dimmed">
        Each view is a saved log: what it shows, and the columns for it. Tapping the view name on
        the widget moves to the next. With no views the widget is a single plain feed. A view with
        no condition shows everything, which makes a useful "all" entry.
      </Text>

      {views.map((view) => (
        <Paper key={view.id} withBorder p="xs" bg="dark.6">
          <Stack gap="xs">
            <Group wrap="nowrap" align="flex-end">
              <TextInput
                label="View name"
                size="xs"
                style={{ flex: 1 }}
                value={view.label}
                onChange={(e) => setView(view.id, { label: e.currentTarget.value })}
              />
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={`Remove view ${view.label}`}
                onClick={() => setViews(views.filter((v) => v.id !== view.id))}
              >
                <IconX size={18} stroke={1.5} />
              </ActionIcon>
            </Group>
            <Group wrap="nowrap" align="flex-end">
              <TextInput
                label="Field"
                size="xs"
                style={{ flex: 1 }}
                placeholder="e.g. desk"
                description="A data field this view requires; blank = no condition"
                value={view.dataKey}
                onChange={(e) => setView(view.id, { dataKey: e.currentTarget.value })}
              />
              <TextInput
                label="Value"
                size="xs"
                style={{ flex: 1 }}
                placeholder="e.g. ARKI"
                description="true and numbers compare as such"
                value={view.dataValue}
                onChange={(e) => setView(view.id, { dataValue: e.currentTarget.value })}
              />
            </Group>
            <TagsInput
              label="Types"
              size="xs"
              description="Empty = keep the widget's own setting"
              value={view.types ?? []}
              onChange={(v) => setView(view.id, { types: v.length ? v : undefined })}
            />
            <MultiSelect
              label="Ingest setups"
              size="xs"
              description={setups.length ? "Empty = the widget's own setting" : "None configured"}
              data={setups.map((s) => ({ value: s.id, label: `${s.name} (${s.kind})` }))}
              value={view.ingestSources ?? []}
              onChange={(v) => setView(view.id, { ingestSources: v.length ? v : undefined })}
              searchable
              clearable
              disabled={!setups.length}
            />
            <Text fz="xs" c="dimmed">
              Columns for this view
            </Text>
            <ColumnsEditor
              columns={view.columns}
              onChange={(columns) => setView(view.id, { columns })}
            />
          </Stack>
        </Paper>
      ))}

      <Button
        variant="light"
        disabled={views.length >= 12}
        onClick={() =>
          setViews([
            ...views,
            {
              id: crypto.randomUUID(),
              label: `View ${views.length + 1}`,
              dataKey: "",
              dataValue: "",
              // Starts from what the widget shows now, so a new view is not a
              // blank slate to rebuild.
              columns: config.columns,
            },
          ])
        }
      >
        Add view
      </Button>

      {!views.length && (
        <>
          <Text fz="sm" fw={600} mt="sm">
            Columns
          </Text>
          <ColumnsEditor columns={config.columns} onChange={setColumns} />
        </>
      )}
    </Stack>
  );
};

export default FeedConfigForm;
