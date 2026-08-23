import { Stack, Text, Textarea } from "@mantine/core";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import { DOC_STATUS_LABEL, useWidgetDocument } from "../../dashboard/useEventDocument.ts";
import { widgetDocument, type NoteConfig } from "./widget.ts";

const NoteView = ({ config, dashboardIsTemplate, updateConfig }: WidgetViewProps<NoteConfig>) => {
  const { value, update, flush, status } = useWidgetDocument({
    config,
    updateConfig,
    dashboardIsTemplate,
    document: widgetDocument,
  });

  return (
    <Stack h="100%" gap={0} p="xs">
      <Textarea
        value={value.text}
        onChange={(e) => update({ text: e.currentTarget.value })}
        onBlur={flush}
        placeholder="Write a note…"
        variant="unstyled"
        disabled={status === "loading" || status === "unavailable"}
        styles={{
          root: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
          wrapper: { flex: 1, display: "flex", minHeight: 0 },
          input: { flex: 1, height: "100%", resize: "none" },
        }}
      />
      <Text c="dimmed" fz="xs" ta="right" mih="1.2em" role="status">
        {DOC_STATUS_LABEL[status]}
      </Text>
    </Stack>
  );
};

export default NoteView;
