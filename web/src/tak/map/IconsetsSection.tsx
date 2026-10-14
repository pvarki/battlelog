import { ActionIcon, Button, FileButton, Group, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconTrash, IconUpload } from "@tabler/icons-react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { importIconset, removeIconset, useIconsets } from "./iconsets.ts";

/** ATAK icon sets imported into this browser, for markers that use their icons. */
export const IconsetsSection = () => {
  const { sets } = useIconsets();

  const importFile = (file: File | null) =>
    file &&
    importIconset(file).then(
      (iconset) =>
        notifications.show({
          color: "success",
          message: `Icon set ${iconset.name} imported: ${iconset.icons.length} icons`,
        }),
      (err) =>
        notifications.show({
          color: "danger",
          title: "Couldn't import icon set",
          message: err instanceof Error ? err.message : String(err),
        }),
    );

  return (
    <Stack gap={6}>
      <SectionHeading>Icon sets</SectionHeading>
      {sets.length === 0 && (
        <Text fz="xs" c="dimmed">
          Markers placed with ATAK icon sets show a generic symbol until their set is imported.
        </Text>
      )}
      {sets.map((set) => (
        <Group key={set.uid} gap="xs" wrap="nowrap">
          <Text fz="sm" style={{ flex: 1 }} truncate title={set.uid}>
            {set.name}
          </Text>
          <Text fz="xs" c="dimmed">
            {set.icons.length} icons
          </Text>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={`Remove icon set ${set.name}`}
            onClick={() => void removeIconset(set.uid)}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}
      <FileButton accept=".zip,application/zip" onChange={importFile}>
        {(p) => (
          <Button {...p} size="xs" variant="default" leftSection={<IconUpload size={14} />}>
            Import icon set
          </Button>
        )}
      </FileButton>
    </Stack>
  );
};
