import { Group, MultiSelect, Select, TextInput } from "@mantine/core";
import type { ColumnFilter, TableColumn } from "./widget.ts";

/** The filter control for a column's kind; used in the header popover and for defaults in settings. */
export const FilterInput = ({
  column,
  seen,
  filter,
  onChange,
}: {
  column: TableColumn;
  seen: string[];
  filter: ColumnFilter;
  onChange: (next: ColumnFilter) => void;
}) => {
  const kind = column.source === "data" ? column.kind : "text";
  if (kind === "boolean") {
    return (
      <Select
        size="xs"
        placeholder="any"
        clearable
        comboboxProps={{ withinPortal: false }}
        data={[
          { value: "yes", label: "yes" },
          { value: "no", label: "no" },
        ]}
        value={filter.bool ?? null}
        onChange={(v) => onChange({ bool: (v as ColumnFilter["bool"]) ?? undefined })}
      />
    );
  }
  if (kind === "choice") {
    const values = [...new Set([...column.options.map((o) => o.value), ...seen.filter(Boolean)])];
    return (
      <MultiSelect
        size="xs"
        placeholder="any"
        comboboxProps={{ withinPortal: false }}
        data={values}
        value={filter.values ?? []}
        onChange={(v) => onChange({ values: v })}
      />
    );
  }
  if (kind === "count") {
    return (
      <Group gap={4} wrap="nowrap" grow>
        <TextInput
          size="xs"
          placeholder="min"
          inputMode="numeric"
          value={filter.min ?? ""}
          onChange={(e) => onChange({ ...filter, min: e.currentTarget.value })}
        />
        <TextInput
          size="xs"
          placeholder="max"
          inputMode="numeric"
          value={filter.max ?? ""}
          onChange={(e) => onChange({ ...filter, max: e.currentTarget.value })}
        />
      </Group>
    );
  }
  return (
    <TextInput
      size="xs"
      placeholder="contains"
      value={filter.text ?? ""}
      onChange={(e) => onChange({ text: e.currentTarget.value })}
    />
  );
};
