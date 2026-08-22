import { Checkbox, Group, NumberInput, Stack, TagsInput, TextInput } from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { COLUMN_LABEL, COLUMNS, type Column, type FeedConfig } from "./widget.ts";

const FeedConfigForm = ({ config, onChange }: WidgetConfigProps<FeedConfig>) => (
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
    <Checkbox.Group
      label="Columns"
      value={[...config.columns]}
      onChange={(v) => {
        const columns = COLUMNS.filter((c): c is Column => v.includes(c));
        if (columns.length) onChange({ ...config, columns });
      }}
    >
      <Group mt={4} gap="sm">
        {COLUMNS.map((c) => (
          <Checkbox key={c} value={c} label={COLUMN_LABEL[c]} />
        ))}
      </Group>
    </Checkbox.Group>
  </Stack>
);

export default FeedConfigForm;
