import { Stack, TextInput } from "@mantine/core";
import { useState } from "react";
import { z } from "zod";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import type { ScheduleConfig } from "./widget.ts";

const uuidSchema = z.string().uuid();
const isUuid = (value: string) => uuidSchema.safeParse(value).success;

const ScheduleConfigForm = ({ config, onChange }: WidgetConfigProps<ScheduleConfig>) => {
  // Local draft so partially-typed ids don't propagate; only valid uuids
  // (or an empty value) reach the config.
  const [idDraft, setIdDraft] = useState(config.eventId ?? "");
  const idValid = idDraft.trim() === "" || isUuid(idDraft.trim());

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
      <TextInput
        label="Event id"
        description="The timer list follows this event's version chain. Paste another schedule widget's id to share its timers, or clear to start a fresh list on the next edit."
        placeholder="Created on first save"
        value={idDraft}
        error={idValid ? undefined : "Not a valid event id"}
        onChange={(e) => {
          const value = e.currentTarget.value;
          setIdDraft(value);
          const trimmed = value.trim();
          if (trimmed === "") onChange({ ...config, eventId: undefined });
          else if (isUuid(trimmed)) onChange({ ...config, eventId: trimmed });
        }}
      />
    </Stack>
  );
};

export default ScheduleConfigForm;
