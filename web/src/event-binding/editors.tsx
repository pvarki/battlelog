import {
  ActionIcon,
  Autocomplete,
  Button,
  CheckIcon,
  ColorSwatch,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { queryFor } from "../widgets/feed/widget.ts";
import { detectFields, type FieldSuggestion } from "./detect.ts";
import { STATUS_COLORS, type StatusColor, type StatusOption } from "./options.ts";
import { type EventQuery, queryFilter } from "./query.ts";

export const OptionsEditor = ({
  options,
  onChange,
}: {
  options: StatusOption[];
  onChange: (next: StatusOption[]) => void;
}) => (
  <Stack gap={4}>
    {options.map((option, index) => (
      <OptionEditor
        // biome-ignore lint/suspicious/noArrayIndexKey: options have no stable id and are edited in place
        key={index}
        option={option}
        onChange={(next) => onChange(options.map((o, i) => (i === index ? next : o)))}
        onRemove={() => onChange(options.filter((_, i) => i !== index))}
      />
    ))}
    <Button
      size="compact-xs"
      variant="subtle"
      onClick={() =>
        onChange([...options, { value: `Option ${options.length + 1}`, color: "gray" }])
      }
    >
      Add option
    </Button>
  </Stack>
);

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
            {option.color === color && (
              <CheckIcon
                size={10}
                color={
                  color === "yellow" || color === "orange" ? "var(--mantine-color-dark-8)" : "white"
                }
              />
            )}
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
        <IconX size={16} stroke={1.5} />
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

/** Types, tags and data filters of an event query. */
export const QueryEditor = <Q extends EventQuery>({
  query,
  onChange,
}: {
  query: Q;
  onChange: (next: Q) => void;
}) => {
  const setFilter = (id: string, patch: Partial<EventQuery["dataFilters"][number]>) =>
    onChange({
      ...query,
      dataFilters: query.dataFilters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    });
  return (
    <Stack gap={4}>
      <Group wrap="nowrap" align="flex-end">
        <TextInput
          label="Event types"
          description="Comma-separated; required"
          size="xs"
          style={{ flex: 1 }}
          value={query.types}
          onChange={(e) => onChange({ ...query, types: e.currentTarget.value })}
        />
        <TextInput
          label="Tags"
          description="Any of, comma-separated"
          size="xs"
          style={{ flex: 1 }}
          value={query.tags}
          onChange={(e) => onChange({ ...query, tags: e.currentTarget.value })}
        />
      </Group>
      {query.dataFilters.map((filter) => (
        <Group key={filter.id} gap={6} wrap="nowrap">
          <TextInput
            size="xs"
            style={{ flex: 1 }}
            placeholder="data path"
            value={filter.path}
            onChange={(e) => setFilter(filter.id, { path: e.currentTarget.value })}
          />
          <TextInput
            size="xs"
            style={{ flex: 1 }}
            placeholder="equals"
            value={filter.value}
            onChange={(e) => setFilter(filter.id, { value: e.currentTarget.value })}
          />
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label="Remove data filter"
            onClick={() =>
              onChange({
                ...query,
                dataFilters: query.dataFilters.filter((f) => f.id !== filter.id),
              })
            }
          >
            <IconX size={16} stroke={1.5} />
          </ActionIcon>
        </Group>
      ))}
      <Button
        size="compact-xs"
        variant="subtle"
        onClick={() =>
          onChange({
            ...query,
            dataFilters: [...query.dataFilters, { id: crypto.randomUUID(), path: "", value: "" }],
          })
        }
      >
        Add data filter
      </Button>
    </Stack>
  );
};

/** Data paths of the events the query currently matches, for field inputs to suggest. */
export const useFieldSuggestions = (query: EventQuery | undefined): FieldSuggestion[] => {
  const filter = query && queryFilter(query);
  const key = filter ? JSON.stringify(queryFor(filter)) : "";
  const [suggestions, setSuggestions] = useState<FieldSuggestion[]>([]);
  useEffect(() => {
    if (!key) return setSuggestions([]);
    let cancelled = false;
    // Debounced: the query fields persist (and change) on every keystroke.
    const timer = setTimeout(async () => {
      try {
        const res = await api.events.$get({ query: { ...JSON.parse(key), limit: 100 } });
        if (!res.ok || cancelled) return;
        const rows = await res.json();
        if (!cancelled) setSuggestions(detectFields(rows.map((r) => r.data)));
      } catch {
        // Suggestions are a convenience: typing a path by hand still works.
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);
  return suggestions;
};

/** A data-path input offering the detected fields; picking one reports its guessed kind. */
export const FieldInput = ({
  label,
  description,
  value,
  suggestions,
  onChange,
  onPick,
}: {
  label: string;
  description?: string;
  value: string;
  suggestions: FieldSuggestion[];
  onChange: (path: string) => void;
  onPick?: (suggestion: FieldSuggestion) => void;
}) => {
  const byPath = new Map(suggestions.map((s) => [s.path, s]));
  return (
    <Autocomplete
      label={label}
      description={description}
      size="xs"
      style={{ flex: 1 }}
      placeholder="status or battery.level"
      data={suggestions.map((s) => s.path)}
      value={value}
      onChange={onChange}
      onOptionSubmit={(path) => {
        const picked = byPath.get(path);
        if (picked) onPick?.(picked);
      }}
      renderOption={({ option }) => {
        const s = byPath.get(option.value);
        return (
          <Group justify="space-between" wrap="nowrap" w="100%">
            <Text fz="xs">{option.value}</Text>
            <Text fz="xs" c="dimmed" truncate>
              {s?.kind}
              {s?.sample ? ` · ${s.sample}` : ""}
            </Text>
          </Group>
        );
      }}
    />
  );
};
