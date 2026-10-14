import { Button, FileButton, Group, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconUpload } from "@tabler/icons-react";
import { useState } from "react";
import type { MapSettings } from "../settings.ts";
import { type CustomSource, parseAtakMapSource, tileUrls } from "./custom-sources.ts";
import { addOfflineMap } from "./offline-maps.ts";

const failed = (title: string) => (err: unknown) =>
  notifications.show({
    color: "red",
    title,
    message: err instanceof Error ? err.message : String(err),
  });

const newId = () => `custom:${crypto.randomUUID()}`;

/** Adding maps: a tile URL, an ATAK map source file, or an offline PMTiles file. */
export const MapSourcesSection = ({ settings }: { settings: MapSettings }) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string>();
  const [storing, setStoring] = useState(false);

  const add = (source: CustomSource) => {
    settings.setCustomSources((list) => [...list, source]);
    settings.setBasemap(source.id);
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
        notifications.show({ color: "teal", message: `Offline map ${source.label} added` });
      }, failed("Couldn't add offline map"))
      .finally(() => setStoring(false));
  };

  return (
    <Stack gap={6}>
      <Text className="tak-group-heading">Add a map</Text>
      <TextInput
        size="xs"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <TextInput
        size="xs"
        placeholder="https://…/{z}/{x}/{y}.png"
        value={url}
        error={error}
        onChange={(e) => setUrl(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && addUrl()}
      />
      <Group gap={6}>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconPlus size={14} />}
          disabled={!url.trim()}
          onClick={addUrl}
        >
          Add by address
        </Button>
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
  );
};
