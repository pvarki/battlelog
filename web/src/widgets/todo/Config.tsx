import { Stack } from "@mantine/core";
import { EventPicker } from "../../dashboard/EventPicker.tsx";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import type { TodoConfig } from "./widget.ts";

const TodoConfigForm = ({ config, onChange }: WidgetConfigProps<TodoConfig>) => (
  <Stack>
    <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
    <EventPicker
      eventType="todo"
      description="The list follows this event's version chain. Pick another todo widget's list to share it, or start fresh to create a new one on the next edit."
      value={config.eventId}
      onChange={(eventId) => onChange({ ...config, eventId })}
    />
  </Stack>
);

export default TodoConfigForm;
