import {
  ActionIcon,
  Badge,
  Checkbox,
  ColorSwatch,
  Group,
  Menu,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useState } from "react";
import type { StatusOption, ValueSpec } from "./options.ts";
import type { BoundState, BoundValue } from "./paths.ts";

// A value switched choice→count still holds its old string: render 0 instead
// of NaN (a NaN would serialize to null and destroy the stored value).
export const countOf = (stored: BoundValue | undefined): number => {
  const n = Number(stored ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const STATE_LABEL: Record<Exclude<BoundState["state"], "ok">, (field: string) => string> = {
  loading: () => "…",
  "missing-event": () => "missing event",
  "missing-field": (field) => `no field "${field}"`,
};

/** A bound value rendered and edited by its spec. `null` is an empty, settable value. */
export const ValueCell = ({
  spec,
  state,
  field,
  onWrite,
  onFlush,
  typeableCount,
}: {
  spec: ValueSpec;
  state: BoundState;
  field: string;
  onWrite: (value: BoundValue) => void;
  /** Save now instead of after the debounce (Enter / leaving a text input). */
  onFlush?: () => void;
  /** Counts also accept a typed number (tables), not only −/+. */
  typeableCount?: boolean;
}) => {
  if (state.state !== "ok") {
    return (
      <Badge color="gray" variant="outline" tt="none">
        {STATE_LABEL[state.state](field.trim())}
      </Badge>
    );
  }
  const readOnly = !spec.editable;
  const shown = state.value === null ? undefined : String(state.value);
  switch (spec.kind) {
    case "count":
      return (
        <CountChip
          count={countOf(state.value)}
          readOnly={readOnly}
          typeable={typeableCount}
          onChange={onWrite}
          onFlush={onFlush}
        />
      );
    case "text":
      return (
        <TextCell value={shown ?? ""} readOnly={readOnly} onWrite={onWrite} onFlush={onFlush} />
      );
    case "boolean":
      return typeof state.value === "boolean" || state.value === null ? (
        <Checkbox
          size="xs"
          aria-label={field}
          checked={state.value === true}
          disabled={readOnly}
          onChange={(e) => onWrite(e.currentTarget.checked)}
        />
      ) : (
        <Text fz="sm">{shown}</Text>
      );
    default:
      return (
        <ChoiceChip
          options={spec.options}
          current={shown}
          unknownLabel={shown}
          readOnly={readOnly}
          onChange={onWrite}
        />
      );
  }
};

export const TextCell = ({
  value,
  readOnly,
  onWrite,
  onFlush,
}: {
  value: string;
  readOnly: boolean;
  onWrite: (value: string) => void;
  onFlush?: () => void;
}) => {
  if (readOnly) {
    return (
      <Text fz="sm" truncate c={value ? undefined : "dimmed"}>
        {value || "—"}
      </Text>
    );
  }
  return (
    <TextInput
      size="xs"
      miw={120}
      placeholder="empty"
      value={value}
      onChange={(e) => onWrite(e.currentTarget.value)}
      onBlur={onFlush}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
};

export const ChoiceChip = ({
  options,
  current,
  onChange,
  unknownLabel,
  readOnly,
}: {
  options: StatusOption[];
  current: string | number | undefined;
  onChange: (value: string) => void;
  unknownLabel?: string;
  readOnly?: boolean;
}) => {
  const selected = options.find((o) => o.value === current);
  const label = selected?.value ?? unknownLabel ?? "not set";
  if (readOnly) {
    return (
      <Badge color={selected?.color ?? "gray"} variant={selected ? "filled" : "outline"} tt="none">
        {label}
      </Badge>
    );
  }
  return (
    <Menu position="bottom-end">
      <Menu.Target>
        <Tooltip
          label={selected?.description}
          disabled={!selected?.description?.trim()}
          openDelay={600}
          multiline
          maw={320}
          position="top-end"
        >
          <Badge
            component="button"
            type="button"
            color={selected?.color ?? "gray"}
            variant={selected ? "filled" : "outline"}
            style={{ cursor: "pointer" }}
          >
            {label}
          </Badge>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {options.length === 0 && <Menu.Item disabled>No options configured</Menu.Item>}
        {options.map((option) => (
          <Menu.Item
            key={option.value}
            leftSection={<ColorSwatch size={10} color={`var(--mantine-color-${option.color}-6)`} />}
            onClick={() => onChange(option.value)}
          >
            {option.value}
            {option.description?.trim() && (
              <Text fz="xs" c="dimmed">
                {option.description}
              </Text>
            )}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};

export const CountChip = ({
  count,
  onChange,
  readOnly,
  typeable,
  onFlush,
}: {
  count: number;
  onChange: (next: number) => void;
  readOnly?: boolean;
  typeable?: boolean;
  onFlush?: () => void;
}) => (
  <Group gap={4} wrap="nowrap">
    {!readOnly && (
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        aria-label="Decrement"
        onClick={() => onChange(count - 1)}
      >
        −
      </ActionIcon>
    )}
    {typeable && !readOnly ? (
      <CountInput count={count} onChange={onChange} onFlush={onFlush} />
    ) : (
      <Badge color="accent" variant="light" miw={36}>
        {count}
      </Badge>
    )}
    {!readOnly && (
      <ActionIcon
        variant="subtle"
        color="gray"
        size="sm"
        aria-label="Increment"
        onClick={() => onChange(count + 1)}
      >
        +
      </ActionIcon>
    )}
  </Group>
);

/** Holds the typed text while focused, so clearing the box to retype doesn't snap back. */
const CountInput = ({
  count,
  onChange,
  onFlush,
}: {
  count: number;
  onChange: (next: number) => void;
  onFlush?: () => void;
}) => {
  const [text, setText] = useState<string | null>(null);
  return (
    <TextInput
      size="xs"
      w={64}
      inputMode="numeric"
      aria-label="Count"
      value={text ?? String(count)}
      onChange={(e) => {
        const typed = e.currentTarget.value;
        setText(typed);
        const n = Number(typed);
        if (typed.trim() && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => {
        setText(null);
        onFlush?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
};
