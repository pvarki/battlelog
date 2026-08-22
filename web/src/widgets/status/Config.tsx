import {
  ActionIcon,
  Button,
  CheckIcon,
  ColorSwatch,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  TextInput,
} from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import {
  STATUS_COLORS,
  type StatusColor,
  type StatusConfig,
  type StatusOption,
  type StatusRow,
} from "./widget.ts";

const StatusConfigForm = ({ config, onChange }: WidgetConfigProps<StatusConfig>) => {
  const setRows = (statuses: StatusRow[]) => onChange({ ...config, statuses });
  const setRow = (id: string, patch: Partial<StatusRow>) =>
    setRows(config.statuses.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <Stack>
      <TextInput
        label="Title"
        placeholder="Shown in the widget header"
        value={config.title ?? ""}
        onChange={(e) =>
          onChange({
            ...config,
            title: e.currentTarget.value.trim() ? e.currentTarget.value : undefined,
          })
        }
      />

      {config.statuses.map((row) => (
        <Paper key={row.id} withBorder p="xs">
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
              <SegmentedControl
                size="xs"
                data={[
                  { label: "Choice", value: "choice" },
                  { label: "Count", value: "count" },
                ]}
                value={row.kind}
                onChange={(kind) => setRow(row.id, { kind: kind as StatusRow["kind"] })}
              />
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove ${row.label}`}
                onClick={() => setRows(config.statuses.filter((r) => r.id !== row.id))}
              >
                ✕
              </ActionIcon>
            </Group>

            <TextInput
              label="Description"
              size="xs"
              placeholder="Shown as a tooltip on hover"
              value={row.description ?? ""}
              onChange={(e) =>
                setRow(row.id, {
                  description: e.currentTarget.value.trim() ? e.currentTarget.value : undefined,
                })
              }
            />

            {row.kind === "choice" && (
              <Stack gap={4}>
                {row.options.map((option, index) => (
                  <OptionEditor
                    // biome-ignore lint/suspicious/noArrayIndexKey: options have no stable id and are edited in place
                    key={index}
                    option={option}
                    onChange={(next) =>
                      setRow(row.id, {
                        options: row.options.map((o, i) => (i === index ? next : o)),
                      })
                    }
                    onRemove={() =>
                      setRow(row.id, { options: row.options.filter((_, i) => i !== index) })
                    }
                  />
                ))}
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() =>
                    setRow(row.id, {
                      options: [
                        ...row.options,
                        { value: `Option ${row.options.length + 1}`, color: "gray" },
                      ],
                    })
                  }
                >
                  Add option
                </Button>
              </Stack>
            )}
          </Stack>
        </Paper>
      ))}

      <Button
        variant="light"
        onClick={() =>
          setRows([
            ...config.statuses,
            {
              id: crypto.randomUUID(),
              label: `Status ${config.statuses.length + 1}`,
              kind: "choice",
              options: [],
            },
          ])
        }
      >
        Add status
      </Button>
    </Stack>
  );
};

const OptionEditor = ({
  option,
  onChange,
  onRemove,
}: {
  option: StatusOption;
  onChange: (next: StatusOption) => void;
  onRemove: () => void;
}) => (
  <Stack gap={2}>
    <Group gap={6} wrap="nowrap">
      <Group gap={4} wrap="nowrap">
        {STATUS_COLORS.map((color) => (
          <ColorSwatch
            key={color}
            size={18}
            color={`var(--mantine-color-${color}-6)`}
            component="button"
            style={{ cursor: "pointer" }}
            aria-label={color}
            onClick={() => onChange({ ...option, color: color as StatusColor })}
          >
            {option.color === color && <CheckIcon size={10} color="white" />}
          </ColorSwatch>
        ))}
      </Group>
      <TextInput
        size="xs"
        style={{ flex: 1 }}
        value={option.value}
        onChange={(e) => onChange({ ...option, value: e.currentTarget.value })}
      />
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        aria-label="Remove option"
        onClick={onRemove}
      >
        ✕
      </ActionIcon>
    </Group>
    <TextInput
      size="xs"
      placeholder="Tooltip shown while this option is selected (optional)"
      value={option.description ?? ""}
      onChange={(e) =>
        onChange({
          ...option,
          description: e.currentTarget.value.trim() ? e.currentTarget.value : undefined,
        })
      }
    />
  </Stack>
);

export default StatusConfigForm;
