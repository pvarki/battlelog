import { Stack, Text, Textarea } from "@mantine/core";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useEventDocument } from "../../dashboard/useEventDocument.ts";
import { headerFor, type NoteConfig } from "./widget.ts";

type NoteDoc = { text: string };

const NoteView = ({ config, updateConfig }: WidgetViewProps<NoteConfig>) => {
  const { value, update, flush, status } = useEventDocument<NoteDoc>({
    eventId: config.eventId,
    eventType: "note",
    headerFor: (doc) => headerFor(doc.text),
    empty: { text: "" },
    parse: (data) => ({ text: (data as { text?: string } | null)?.text ?? "" }),
    onEventIdCaptured: (id) => updateConfig({ ...config, eventId: id }),
    debounceMs: 2000,
  });

  return (
    <Stack h="100%" gap={0} p="xs">
      <Textarea
        value={value.text}
        onChange={(e) => update({ text: e.currentTarget.value })}
        onBlur={flush}
        placeholder="Write a note…"
        variant="unstyled"
        disabled={status === "loading"}
        styles={{
          root: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
          wrapper: { flex: 1, display: "flex", minHeight: 0 },
          input: { flex: 1, height: "100%", resize: "none" },
        }}
      />
      <Text c="dimmed" fz="xs" ta="right" mih="1.2em">
        {DOC_STATUS_LABEL[status]}
      </Text>
    </Stack>
  );
};

export default NoteView;
