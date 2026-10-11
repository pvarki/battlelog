import { Stack } from "@mantine/core";
import { EventPicker } from "../../dashboard/EventPicker.tsx";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import type { NoteConfig } from "./widget.ts";

const NoteConfigForm = ({ config, onChange }: WidgetConfigProps<NoteConfig>) => (
  <Stack>
    <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
    <EventPicker
      eventType="note"
      description="The note follows this event's version chain. Pick another note to follow it, or start fresh to create a new note on the next edit."
      value={config.eventId}
      onChange={(eventId) => onChange({ ...config, eventId })}
    />
  </Stack>
);

export default NoteConfigForm;
