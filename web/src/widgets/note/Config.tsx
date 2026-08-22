import { Stack, TextInput } from "@mantine/core";
import { useState } from "react";
import { z } from "zod";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import type { NoteConfig } from "./widget.ts";

const uuidSchema = z.string().uuid();
const isUuid = (value: string) => uuidSchema.safeParse(value).success;

const NoteConfigForm = ({ config, onChange }: WidgetConfigProps<NoteConfig>) => {
  const [idDraft, setIdDraft] = useState(config.eventId ?? "");
  const idValid = idDraft.trim() === "" || isUuid(idDraft.trim());

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
      <TextInput
        label="Event id"
        description="The note follows this event's version chain. Paste another note's id to follow it, or clear to start a fresh note on the next edit."
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

export default NoteConfigForm;
