import { Stack } from "@mantine/core";
import { EventPicker } from "../../dashboard/EventPicker.tsx";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import type { ScheduleConfig } from "./widget.ts";

const ScheduleConfigForm = ({ config, onChange }: WidgetConfigProps<ScheduleConfig>) => (
  <Stack>
    <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
    <EventPicker
      eventType="schedule"
      description="The timer list follows this event's version chain. Pick another schedule widget's list to share its timers, or start fresh to create a new list on the next edit."
      value={config.eventId}
      onChange={(eventId) => onChange({ ...config, eventId })}
    />
  </Stack>
);

export default ScheduleConfigForm;
