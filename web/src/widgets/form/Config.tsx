import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { EVENT_FIELDS, type EventFieldName, type FormConfig, type FormField } from "./widget.ts";

const EVENT_FIELD_OPTIONS = Object.entries(EVENT_FIELDS).map(([value, label]) => ({
  value,
  label,
}));

const FormConfigForm = ({ config, onChange }: WidgetConfigProps<FormConfig>) => {
  const setFields = (fields: FormField[]) => onChange({ ...config, fields });
  const setField = (id: string, patch: Partial<FormField>) =>
    setFields(config.fields.map((f) => (f.id === id ? ({ ...f, ...patch } as FormField) : f)));
  const move = (index: number, delta: number) => {
    const next = [...config.fields];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    next.splice(target, 0, ...next.splice(index, 1));
    setFields(next);
  };
  const add = (field: FormField) => setFields([...config.fields, field]);

  return (
    <Stack>
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
            submitLabel: e.currentTarget.value.trim() ? e.currentTarget.value : undefined,
          })
        }
      />

      {config.fields.map((field, index) => (
        <Paper key={field.id} withBorder p="xs">
          <Stack gap="xs">
            <Group wrap="nowrap" justify="space-between">
              <Text fz="xs" c="dimmed">
                {field.kind === "event"
                  ? "Event field"
                  : field.kind === "data"
                    ? "Custom field"
                    : "Fixed value"}
              </Text>
              <Group gap={2} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="xs"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="xs"
                  aria-label="Move down"
                  disabled={index === config.fields.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  size="xs"
                  aria-label="Remove field"
                  onClick={() => setFields(config.fields.filter((f) => f.id !== field.id))}
                >
                  ✕
                </ActionIcon>
              </Group>
            </Group>

            {field.kind === "event" && (
              <Group wrap="nowrap" align="flex-end">
                <Select
                  size="xs"
                  style={{ flex: 1 }}
                  data={EVENT_FIELD_OPTIONS}
                  value={field.field}
                  onChange={(v) => v && setField(field.id, { field: v as EventFieldName })}
                />
                <Checkbox
                  size="xs"
                  label="Required"
                  checked={field.required ?? false}
                  onChange={(e) => setField(field.id, { required: e.currentTarget.checked })}
                />
              </Group>
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
                  <Select
                    label="Input"
                    size="xs"
                    data={["text", "textarea", "number", "select", "checkbox"]}
                    value={field.input}
                    onChange={(v) => v && setField(field.id, { input: v as typeof field.input })}
                  />
                  <Checkbox
                    size="xs"
                    label="Required"
                    checked={field.required ?? false}
                    onChange={(e) => setField(field.id, { required: e.currentTarget.checked })}
                  />
                </Group>
                {field.input === "select" && (
                  <TagsInput
                    label="Options"
                    size="xs"
                    value={field.options}
                    onChange={(options) => setField(field.id, { options })}
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
        </Paper>
      ))}

      <Group grow>
        <Button
          size="compact-xs"
          variant="light"
          onClick={() => add({ id: crypto.randomUUID(), kind: "event", field: "header" })}
        >
          + Event field
        </Button>
        <Button
          size="compact-xs"
          variant="light"
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
          + Custom field
        </Button>
        <Button
          size="compact-xs"
          variant="light"
          onClick={() => add({ id: crypto.randomUUID(), kind: "fixed", target: "tags", value: "" })}
        >
          + Fixed value
        </Button>
      </Group>
    </Stack>
  );
};

export default FormConfigForm;
