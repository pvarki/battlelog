import { TextInput } from "@mantine/core";

/**
 * The optional widget title rendered by WidgetWrapper. maxLength matches the
 * config schemas' `title: max(100)` so typing can't produce an invalid config.
 */
export const TitleInput = ({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (title: string | undefined) => void;
}) => (
  <TextInput
    label="Title"
    placeholder="Shown in the widget header"
    maxLength={100}
    value={value ?? ""}
    onChange={(e) => onChange(e.currentTarget.value.trim() ? e.currentTarget.value : undefined)}
  />
);
