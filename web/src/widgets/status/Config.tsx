import { Button, Group, SegmentedControl, Stack, Switch, TextInput } from "@mantine/core";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { EventPicker } from "../../dashboard/EventPicker.tsx";
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
import { optionalText } from "../../form-utils.ts";
import type { StatusConfig, StatusGroup, StatusProperty, StatusRow } from "./widget.ts";

const EMPTY_GROUP: StatusGroup = {
  types: "",
  tags: "",
  dataFilters: [],
  field: "",
  layout: "list",
  labelField: "",
  properties: [],
};

const KIND_OPTIONS = [
  { label: "Choice", value: "choice" },
  { label: "Count", value: "count" },
  { label: "Text", value: "text" },
];

/** A picked suggestion fills what the user hasn't set yet: label, and kind/options while still default. */
const fromSuggestion = (
  current: { label: string; kind: string; options: unknown[] },
  s: FieldSuggestion,
) => ({
  field: s.path,
  ...(current.label.trim() ? {} : { label: s.path.split(".").at(-1) ?? s.path }),
  ...(current.kind === "choice" && current.options.length === 0 && s.kind !== "boolean"
    ? {
        kind: s.kind,
        options: s.options.map((value) => ({ value, color: "gray" as const })),
      }
    : {}),
});

const PropertyEditor = ({
  property,
  suggestions,
  onChange,
  onRemove,
}: {
  property: StatusProperty;
  suggestions: FieldSuggestion[];
  onChange: (patch: Partial<StatusProperty>) => void;
  onRemove: () => void;
}) => (
  <ItemCard name={property.label || "property"} onRemove={onRemove}>
    <Stack gap={4}>
      <Group wrap="nowrap" align="flex-end">
        <TextInput
          label="Label"
          size="xs"
          style={{ flex: 1 }}
          value={property.label}
          onChange={(e) => onChange({ label: e.currentTarget.value })}
        />
        <FieldInput
          label="Field"
          value={property.field}
          suggestions={suggestions}
          onChange={(field) => onChange({ field })}
          onPick={(s) => onChange(fromSuggestion(property, s))}
        />
      </Group>
      <SegmentedControl
        size="xs"
        data={KIND_OPTIONS}
        value={property.kind}
        onChange={(kind) => onChange({ kind: kind as StatusProperty["kind"] })}
      />
      <Switch
        size="xs"
        label="Allow updating from the board"
        checked={property.editable}
        onChange={(e) => onChange({ editable: e.currentTarget.checked })}
      />
      {property.kind === "choice" && (
        <OptionsEditor options={property.options} onChange={(options) => onChange({ options })} />
      )}
    </Stack>
  </ItemCard>
);

const GroupEditor = ({
  group,
  onChange,
}: {
  group: StatusGroup;
  onChange: (next: StatusGroup) => void;
}) => {
  const suggestions = useFieldSuggestions(group);
  return (
    <Stack gap={4}>
      <QueryEditor query={group} onChange={onChange} />
      <SegmentedControl
        size="xs"
        data={[
          { label: "One value per event", value: "list" },
          { label: "Section per event", value: "sections" },
        ]}
        value={group.layout}
        onChange={(layout) => onChange({ ...group, layout: layout as StatusGroup["layout"] })}
      />
      {group.layout === "list" ? (
        <FieldInput
          label="Field"
          description="Shown for every matching event; the label above is the group header"
          value={group.field}
          suggestions={suggestions}
          onChange={(field) => onChange({ ...group, field })}
        />
      ) : (
        <>
          <FieldInput
            label="Section title field"
            description="Data field used as each event's title; its header when empty or missing"
            value={group.labelField}
            suggestions={suggestions}
            onChange={(labelField) => onChange({ ...group, labelField })}
          />
          {group.properties.map((property) => (
            <PropertyEditor
              key={property.id}
              property={property}
              suggestions={suggestions}
              onChange={(patch) =>
                onChange({
                  ...group,
                  properties: group.properties.map((p) =>
                    p.id === property.id ? { ...p, ...patch } : p,
                  ),
                })
              }
              onRemove={() =>
                onChange({
                  ...group,
                  properties: group.properties.filter((p) => p.id !== property.id),
                })
              }
            />
          ))}
          <Button
            size="xs"
            variant="default"
            onClick={() =>
              onChange({
                ...group,
                properties: [
                  ...group.properties,
                  {
                    id: crypto.randomUUID(),
                    label: "",
                    field: "",
                    kind: "choice",
                    options: [],
                    editable: false,
                  },
                ],
              })
            }
          >
            Add property
          </Button>
        </>
      )}
    </Stack>
  );
};

const StatusConfigForm = ({ config, onChange }: WidgetConfigProps<StatusConfig>) => {
  const setRows = (statuses: StatusRow[]) => onChange({ ...config, statuses });
  const setRow = (id: string, patch: Partial<StatusRow>) =>
    setRows(config.statuses.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const setSource = (row: StatusRow, patch: Partial<NonNullable<StatusRow["source"]>>) =>
    setRow(row.id, { source: { eventId: "", field: "", ...row.source, ...patch } });

  const sectionsMode = (row: StatusRow) => row.group?.layout === "sections";

  return (
    <Stack>
      <SectionHeading>General</SectionHeading>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />

      <SectionHeading>Statuses</SectionHeading>
      {config.statuses.map((row, index) => (
        <ItemCard
          key={row.id}
          name={row.label || "status"}
          onRemove={() => setRows(config.statuses.filter((r) => r.id !== row.id))}
          move={{
            index,
            count: config.statuses.length,
            onMove: (by) => setRows(moveItem(config.statuses, index, by)),
          }}
        >
          <Stack gap="xs">
            <Group wrap="nowrap" align="flex-end">
              <TextInput
                label="Label"
                description="Use / to group, e.g. 1.ryhmä/Pena (3 levels max)"
                size="xs"
                style={{ flex: 1 }}
                value={row.label}
                onChange={(e) => setRow(row.id, { label: e.currentTarget.value })}
              />
              {!sectionsMode(row) && (
                <SegmentedControl
                  size="xs"
                  data={KIND_OPTIONS}
                  value={row.kind}
                  onChange={(kind) => setRow(row.id, { kind: kind as StatusRow["kind"] })}
                />
              )}
            </Group>

            <TextInput
              label="Description"
              size="xs"
              placeholder="Shown as a tooltip on hover"
              value={row.description ?? ""}
              onChange={(e) =>
                setRow(row.id, {
                  description: optionalText(e.currentTarget.value),
                })
              }
            />

            <SegmentedControl
              size="xs"
              data={[
                { label: "Board value", value: "local" },
                { label: "One event", value: "event" },
                { label: "Events by query", value: "query" },
              ]}
              value={row.group ? "query" : row.source ? "event" : "local"}
              onChange={(mode) =>
                setRow(row.id, {
                  source: mode === "event" ? { eventId: "", field: "" } : undefined,
                  group: mode === "query" ? EMPTY_GROUP : undefined,
                  editable: false,
                })
              }
            />
            {row.source && (
              <>
                <EventPicker
                  emptyText="No event selected."
                  value={row.source.eventId || undefined}
                  onChange={(eventId) => setSource(row, { eventId: eventId ?? "" })}
                />
                <TextInput
                  label="Field"
                  size="xs"
                  placeholder="status or battery.level"
                  value={row.source.field}
                  onChange={(e) => setSource(row, { field: e.currentTarget.value })}
                />
              </>
            )}
            {row.group && (
              <GroupEditor group={row.group} onChange={(group) => setRow(row.id, { group })} />
            )}
            {(row.source || (row.group && !sectionsMode(row))) && (
              <Switch
                size="xs"
                label="Allow updating from the board"
                checked={row.editable}
                onChange={(e) => setRow(row.id, { editable: e.currentTarget.checked })}
              />
            )}

            {row.kind === "choice" && !sectionsMode(row) && (
              <OptionsEditor
                options={row.options}
                onChange={(options) => setRow(row.id, { options })}
              />
            )}
          </Stack>
        </ItemCard>
      ))}

      <Button
        size="xs"
        variant="default"
        onClick={() =>
          setRows([
            ...config.statuses,
            {
              id: crypto.randomUUID(),
              label: `Status ${config.statuses.length + 1}`,
              kind: "choice",
              options: [],
              editable: false,
            },
          ])
        }
      >
        Add status
      </Button>
    </Stack>
  );
};

export default StatusConfigForm;
