import {
  ActionIcon,
  Button,
  Checkbox,
  Divider,
  Group,
  Menu,
  SegmentedControl,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { optionalText } from "../../dashboard/form-utils.ts";
import { ItemCard, moveItem } from "../../dashboard/ItemCard.tsx";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { FieldInput, QueryEditor, useFieldSuggestions } from "../../event-binding/editors.tsx";
import {
  buildEvent,
  dataKey,
  EMPTY_EVENT_SELECT,
  EVENT_FIELDS,
  type EventFieldName,
  type EventSelect,
  type FormConfig,
  type FormField,
  fieldLabel,
  type VisibleField,
} from "./widget.ts";

const EVENT_FIELD_OPTIONS = Object.entries(EVENT_FIELDS).map(([value, label]) => ({
  value,
  label,
}));

const DescriptionInput = ({
  field,
  setField,
}: {
  field: VisibleField;
  setField: (id: string, patch: Partial<FormField>) => void;
}) => (
  <TextInput
    label="Description"
    placeholder="Optional hint shown under the label"
    size="xs"
    value={field.description ?? ""}
    onChange={(e) => setField(field.id, { description: optionalText(e.currentTarget.value) })}
  />
);

const FIELD_KIND_LABEL: Record<FormField["kind"], string> = {
  event: "Event field",
  data: "Custom field",
  fixed: "Fixed value",
};

const fieldName = (field: FormField) =>
  (field.kind !== "fixed" && fieldLabel(field)) || FIELD_KIND_LABEL[field.kind].toLowerCase();

const INPUT_OPTIONS = [
  { value: "text", label: "text" },
  { value: "textarea", label: "textarea" },
  { value: "number", label: "number" },
  { value: "select", label: "select" },
  { value: "checkbox", label: "checkbox" },
  { value: "event", label: "event (pick from a query)" },
  { value: "tak", label: "TAK item" },
];

const EventSelectEditor = ({
  select,
  onChange,
}: {
  select: EventSelect;
  onChange: (next: EventSelect) => void;
}) => {
  const suggestions = useFieldSuggestions(select);
  const setRule = (id: string, patch: Partial<EventSelect["writeBack"][number]>) =>
    onChange({
      ...select,
      writeBack: select.writeBack.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  return (
    <Stack gap={4}>
      <Text fz="xs" fw={500}>
        Options: events matching
      </Text>
      <QueryEditor query={select} onChange={onChange} />
      <FieldInput
        label="Option label"
        description="Data field shown for each option (and stored as the label); header when empty"
        value={select.labelField}
        suggestions={suggestions}
        onChange={(labelField) => onChange({ ...select, labelField })}
      />
      <TextInput
        label="Text when empty"
        size="xs"
        placeholder="No options available"
        value={select.emptyText}
        onChange={(e) => onChange({ ...select, emptyText: e.currentTarget.value })}
      />
      <Text fz="xs" fw={500} mt={4}>
        On submit, update the picked event
      </Text>
      {select.writeBack.map((rule) => (
        <Group key={rule.id} gap={6} wrap="nowrap" align="flex-end">
          <FieldInput
            label="Field"
            value={rule.field}
            suggestions={suggestions}
            onChange={(field) => setRule(rule.id, { field })}
          />
          <Select
            label="Set to"
            size="xs"
            w={150}
            data={[
              { value: "text", label: "Value" },
              { value: "reference", label: "This submission" },
            ]}
            value={rule.set}
            onChange={(set) => set && setRule(rule.id, { set: set as typeof rule.set })}
          />
          {rule.set === "text" && (
            <TextInput
              label="Value"
              size="xs"
              style={{ flex: 1 }}
              value={rule.value}
              onChange={(e) => setRule(rule.id, { value: e.currentTarget.value })}
            />
          )}
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Remove update"
            onClick={() =>
              onChange({ ...select, writeBack: select.writeBack.filter((r) => r.id !== rule.id) })
            }
          >
            <IconX size={14} stroke={1.5} />
          </ActionIcon>
        </Group>
      ))}
      <Button
        size="compact-xs"
        variant="subtle"
        onClick={() =>
          onChange({
            ...select,
            writeBack: [
              ...select.writeBack,
              { id: crypto.randomUUID(), field: "", set: "text", value: "" },
            ],
          })
        }
      >
        Add update
      </Button>
    </Stack>
  );
};

const FormConfigForm = ({ config, onChange }: WidgetConfigProps<FormConfig>) => {
  const setFields = (fields: FormField[]) => onChange({ ...config, fields });
  const setField = (id: string, patch: Partial<FormField>) =>
    setFields(config.fields.map((f) => (f.id === id ? ({ ...f, ...patch } as FormField) : f)));
  const add = (field: FormField) => setFields([...config.fields, field]);
  const hasCoordinates = config.fields.some(
    (f) => f.kind === "event" && f.field === "locationPoint",
  );

  return (
    <Stack>
      <Divider label="General" labelPosition="left" />
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
      <TextInput
        label="Report type"
        description={`Events are posted with type "form-${config.reportType || "…"}"`}
        value={config.reportType}
        onChange={(e) => onChange({ ...config, reportType: e.currentTarget.value })}
      />
      <TextInput
        label="Submit button label"
        placeholder="Submit"
        value={config.submitLabel ?? ""}
        onChange={(e) =>
          onChange({
            ...config,
            submitLabel: optionalText(e.currentTarget.value),
          })
        }
      />
      <Checkbox
        label="Allow editing"
        description="Clicking one of this form's events in a feed loads it here for editing"
        checked={config.allowEdit ?? false}
        onChange={(e) => onChange({ ...config, allowEdit: e.currentTarget.checked || undefined })}
      />

      <Divider label="Fields" labelPosition="left" />
      {config.fields.map((field, index) => (
        <ItemCard
          key={field.id}
          label={FIELD_KIND_LABEL[field.kind]}
          name={fieldName(field)}
          onRemove={() => setFields(config.fields.filter((f) => f.id !== field.id))}
          move={{
            index,
            count: config.fields.length,
            onMove: (by) => setFields(moveItem(config.fields, index, by)),
          }}
        >
          <Stack gap="xs">
            {field.kind === "event" && (
              <>
                <Group wrap="nowrap" align="flex-end">
                  <Select
                    label="Field"
                    size="xs"
                    style={{ flex: 1 }}
                    data={EVENT_FIELD_OPTIONS}
                    value={field.field}
                    onChange={(v) => v && setField(field.id, { field: v as EventFieldName })}
                  />
                  <TextInput
                    label="Label"
                    size="xs"
                    style={{ flex: 1 }}
                    placeholder={EVENT_FIELDS[field.field]}
                    value={field.label ?? ""}
                    onChange={(e) => setField(field.id, { label: e.currentTarget.value })}
                  />
                  <Checkbox
                    size="xs"
                    label="Required"
                    checked={field.required ?? false}
                    onChange={(e) => setField(field.id, { required: e.currentTarget.checked })}
                  />
                </Group>
                <DescriptionInput field={field} setField={setField} />
                {field.field === "eventTime" && (
                  <Checkbox
                    size="xs"
                    label="Hide Now button"
                    checked={field.hideNowButton ?? false}
                    onChange={(e) =>
                      setField(field.id, {
                        hideNowButton: e.currentTarget.checked || undefined,
                      })
                    }
                  />
                )}
              </>
            )}

            {field.kind === "data" && (
              <>
                <Group wrap="nowrap" align="flex-end">
                  <TextInput
                    label="Label"
                    size="xs"
                    style={{ flex: 1 }}
                    value={field.label}
                    onChange={(e) => setField(field.id, { label: e.currentTarget.value })}
                  />
                  <TextInput
                    label="Data key"
                    size="xs"
                    style={{ flex: 1 }}
                    placeholder={dataKey({ ...field, key: undefined })}
                    value={field.key ?? ""}
                    onChange={(e) => setField(field.id, { key: e.currentTarget.value })}
                  />
                </Group>
                <Group wrap="nowrap" align="flex-end">
                  <Select
                    label="Input"
                    size="xs"
                    data={INPUT_OPTIONS}
                    value={field.input}
                    onChange={(v) =>
                      v &&
                      setField(field.id, {
                        input: v as typeof field.input,
                        ...(v === "event" && !field.eventSelect
                          ? { eventSelect: EMPTY_EVENT_SELECT }
                          : {}),
                      })
                    }
                  />
                  <Checkbox
                    size="xs"
                    label="Required"
                    checked={field.required ?? false}
                    onChange={(e) => setField(field.id, { required: e.currentTarget.checked })}
                  />
                </Group>
                <DescriptionInput field={field} setField={setField} />
                {field.input === "select" && (
                  <TagsInput
                    label="Options"
                    size="xs"
                    value={field.options}
                    onChange={(options) => setField(field.id, { options })}
                  />
                )}
                {field.input === "event" && (
                  <EventSelectEditor
                    select={field.eventSelect ?? EMPTY_EVENT_SELECT}
                    onChange={(eventSelect) => setField(field.id, { eventSelect })}
                  />
                )}
                {field.input === "tak" && (
                  <Checkbox
                    size="xs"
                    label="Also set Coordinates from the item"
                    description={
                      hasCoordinates
                        ? "Where the item is when picked; it doesn't follow the item later"
                        : "Add an event field “Coordinates” for this to apply"
                    }
                    checked={field.takSetsLocation ?? false}
                    onChange={(e) =>
                      setField(field.id, { takSetsLocation: e.currentTarget.checked || undefined })
                    }
                  />
                )}
              </>
            )}

            {field.kind === "fixed" && (
              <Group wrap="nowrap" align="flex-end">
                <SegmentedControl
                  size="xs"
                  data={[
                    { label: "Tag", value: "tags" },
                    { label: "Data", value: "data" },
                    { label: "Header", value: "header" },
                  ]}
                  value={field.target}
                  onChange={(target) =>
                    setField(field.id, { target: target as typeof field.target })
                  }
                />
                {field.target === "data" && (
                  <TextInput
                    label="Key"
                    size="xs"
                    style={{ flex: 1 }}
                    value={field.key ?? ""}
                    onChange={(e) => setField(field.id, { key: e.currentTarget.value })}
                  />
                )}
                <TextInput
                  label="Value"
                  size="xs"
                  style={{ flex: 1 }}
                  value={field.value}
                  onChange={(e) => setField(field.id, { value: e.currentTarget.value })}
                />
              </Group>
            )}
          </Stack>
        </ItemCard>
      ))}

      {!config.fields.some((f) => f.kind === "event" && f.field === "header") && (
        <Text fz="xs" c="dimmed">
          No header input — every event is titled “{buildEvent(config, {}).header}”. Add an event
          field “Header”, or a fixed value targeting Header, to change that.
        </Text>
      )}

      <Menu position="bottom-start">
        <Menu.Target>
          <Button variant="light">Add field</Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            onClick={() => add({ id: crypto.randomUUID(), kind: "event", field: "header" })}
          >
            {FIELD_KIND_LABEL.event}
          </Menu.Item>
          <Menu.Item
            onClick={() =>
              add({
                id: crypto.randomUUID(),
                kind: "data",
                label: `Field ${config.fields.length + 1}`,
                input: "text",
                options: [],
              })
            }
          >
            {FIELD_KIND_LABEL.data}
          </Menu.Item>
          <Menu.Item
            onClick={() =>
              add({
                id: crypto.randomUUID(),
                kind: "data",
                label: "TAK item",
                input: "tak",
                options: [],
              })
            }
          >
            TAK item
          </Menu.Item>
          <Menu.Item
            onClick={() =>
              add({ id: crypto.randomUUID(), kind: "fixed", target: "tags", value: "" })
            }
          >
            {FIELD_KIND_LABEL.fixed}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Stack>
  );
};

export default FormConfigForm;
