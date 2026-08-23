import { ActionIcon, Checkbox, Group, Stack, Text, TextInput } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { useState } from "react";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useWidgetDocument } from "../../dashboard/useEventDocument.ts";
import { widgetDocument, type TodoConfig, type TodoItem } from "./widget.ts";

// A checkbox list stored as one event document, sharing the note widget's
// autosave machinery. ponytail: the whole list is one event, so two screens
// toggling simultaneously race — loser gets 409, reloads the head and re-taps;
// item-per-event when tasks become ordered/reported entities.
const TodoView = ({ config, dashboardIsTemplate, updateConfig }: WidgetViewProps<TodoConfig>) => {
  const [draft, setDraft] = useState("");
  const { value, update, status } = useWidgetDocument({
    config,
    updateConfig,
    dashboardIsTemplate,
    document: widgetDocument,
  });
  const items = value.items;

  const commit = (next: TodoItem[]) => update({ items: next });
  const toggle = (id: string) =>
    commit(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  const remove = (id: string) => commit(items.filter((i) => i.id !== id));
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    commit([...items, { id: crypto.randomUUID(), text, done: false }]);
  };

  return (
    <Stack h="100%" gap="xs" p="xs">
      <Stack gap={4} style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {items.length === 0 && status !== "loading" ? (
          <Text c="dimmed" fz="sm">
            No items yet.
          </Text>
        ) : (
          items.map((item) => (
            <Group key={item.id} gap="xs" wrap="nowrap" justify="space-between">
              <Checkbox
                checked={item.done}
                onChange={() => toggle(item.id)}
                label={item.text}
                styles={{
                  label: item.done ? { textDecoration: "line-through", opacity: 0.6 } : undefined,
                }}
              />
              <ActionIcon
                variant="subtle"
                color="gray"
                size="xs"
                aria-label={`Remove ${item.text}`}
                onClick={() => remove(item.id)}
              >
                <IconX size={14} stroke={1.5} />
              </ActionIcon>
            </Group>
          ))
        )}
      </Stack>
      <TextInput
        size="xs"
        placeholder="Add item…"
        value={draft}
        disabled={status === "loading" || status === "unavailable"}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") add();
        }}
      />
      <Text c="dimmed" fz="xs" ta="right" mih="1.2em" role="status">
        {DOC_STATUS_LABEL[status]}
      </Text>
    </Stack>
  );
};

export default TodoView;
