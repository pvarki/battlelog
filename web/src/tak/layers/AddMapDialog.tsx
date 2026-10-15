import { Button, FileButton, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconUpload } from "@tabler/icons-react";
import { useState } from "react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { type CustomSource, parseAtakMapSource, tileUrls } from "../map/custom-sources.ts";
import { addOfflineMap } from "../map/offline-maps.ts";
import type { MapSettings } from "../settings.ts";

const failed = (title: string) => (err: unknown) =>
  notifications.show({
    color: "danger",
    title,
    message: err instanceof Error ? err.message : String(err),
  });

const newId = () => `custom:${crypto.randomUUID()}`;

/** Adding maps: a tile URL, an ATAK map source file, or an offline PMTiles file. */
export const AddMapDialog = ({
  settings,
  opened,
  onClose,
}: {
  settings: MapSettings;
  opened: boolean;
  onClose: () => void;
}) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string>();
  const [storing, setStoring] = useState(false);

  const add = (source: CustomSource) => {
    settings.setCustomSources((list) => [...list, source]);
    settings.setBasemap(source.id);
    onClose();
  };

  const addUrl = () => {
    try {
      const tiles = tileUrls(url);
      const host = new URL(tiles.tiles[0]?.replace(/[{}]/g, "") ?? "").hostname;
      add({ id: newId(), label: name.trim() || host, minzoom: 0, maxzoom: 19, ...tiles });
      setName("");
      setUrl("");
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const importAtak = (file: File | null) =>
    file
      ?.text()
      .then((xml) => add(parseAtakMapSource(xml, newId())))
      .catch(failed("Couldn't import map source"));

  const importOffline = (file: File | null) => {
    if (!file) return;
    setStoring(true);
    addOfflineMap(file)
      .then((source) => {
        settings.setBasemap(source.id);
        notifications.show({ color: "success", message: `Offline map ${source.label} added` });
        onClose();
      }, failed("Couldn't add offline map"))
      .finally(() => setStoring(false));
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Add a map">
      <Stack gap="md">
        <Stack gap={6}>
          <TextInput
            size="xs"
            label="Tile address"
            placeholder="https://…/{z}/{x}/{y}.png"
            data-autofocus
            value={url}
            error={error}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addUrl()}
          />
          <TextInput
            size="xs"
            label="Name"
            placeholder="From the address"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && addUrl()}
          />
          <Group justify="flex-end">
            <Button size="xs" disabled={!url.trim()} onClick={addUrl}>
              Add
            </Button>
          </Group>
        </Stack>
        <Stack gap={6}>
          <SectionHeading>Or from a file</SectionHeading>
          <Group gap={6}>
            <FileButton accept=".xml,application/xml,text/xml" onChange={importAtak}>
              {(p) => (
                <Button {...p} size="xs" variant="default" leftSection={<IconUpload size={14} />}>
                  ATAK map source
                </Button>
              )}
            </FileButton>
            <FileButton accept=".pmtiles" onChange={importOffline}>
              {(p) => (
                <Button
                  {...p}
                  size="xs"
                  variant="default"
                  loading={storing}
                  leftSection={<IconUpload size={14} />}
                >
                  Offline map
                </Button>
              )}
            </FileButton>
          </Group>
          <Text fz="xs" c="dimmed">
            Offline maps are raster PMTiles files kept in this browser. Convert MBTiles with{" "}
            <code>pmtiles convert in.mbtiles out.pmtiles</code>.
          </Text>
        </Stack>
      </Stack>
    </Modal>
  );
};
