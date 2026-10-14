import {
  ActionIcon,
  Button,
  Group,
  Radio,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPhoto, IconPrinter, IconTrash } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { ReactNode } from "react";
import { COORD_FORMATS, type CoordFormat } from "../coords.ts";
import { download } from "../download.ts";
import { setPictureSaving } from "../session.ts";
import type { MapSettings } from "../settings.ts";
import { DEFAULT_BASEMAP, type MapSource } from "./basemaps.ts";
import { GroupsSection } from "./GroupsSection.tsx";
import { IconsetsSection } from "./IconsetsSection.tsx";
import { MapSourcesSection } from "./MapSourcesSection.tsx";
import { mapImageBlob, printImage } from "./map-image.ts";
import { removeOfflineMap } from "./offline-maps.ts";
import { SaveAreaSection } from "./SaveAreaSection.tsx";

type Props = {
  settings: MapSettings;
  sources: MapSource[];
  /** The map on screen and its background, for saving the visible area offline. */
  map?: MapLibreMap;
  basemap: MapSource;
  /** Set by the dashboard widget, so not this browser's to change here. */
  basemapPinned?: boolean;
  /** This connection's uid on TAK; undefined without a callsign. */
  clientUid: string | undefined;
  /** The BattleLog layers section. */
  eventLayers: ReactNode;
  /** Developer tools; only passed in dev builds. */
  children?: ReactNode;
};

const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

const imageFailed = (err: unknown) =>
  notifications.show({
    color: "red",
    title: "Couldn't make the map image",
    message: err instanceof Error ? err.message : String(err),
  });

const Heading = ({ children }: { children: ReactNode }) => (
  <Text className="tak-group-heading">{children}</Text>
);

export const LayersDrawer = ({
  settings,
  sources,
  map,
  basemap,
  basemapPinned,
  clientUid,
  eventLayers,
  children,
}: Props) => {
  const remove = (source: MapSource) => {
    if (settings.basemap === source.id) settings.setBasemap(DEFAULT_BASEMAP);
    if (settings.overlay === source.id) settings.setOverlay(null);
    if (source.origin === "offline") void removeOfflineMap(source);
    else settings.setCustomSources((list) => list.filter((s) => s.id !== source.id));
  };

  return (
    <Stack gap="md">
      {eventLayers}

      <Radio.Group
        label={<Heading>Background map</Heading>}
        description={basemapPinned ? "Set by this widget" : undefined}
        value={basemap.id}
        onChange={settings.setBasemap}
      >
        <Stack gap={6} mt={6}>
          {sources.map((source) => (
            <Group key={source.id} gap="xs" wrap="nowrap" justify="space-between">
              <Radio size="xs" value={source.id} label={source.label} disabled={basemapPinned} />
              {source.origin !== "builtin" && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Remove map ${source.label}`}
                  onClick={() => remove(source)}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              )}
            </Group>
          ))}
        </Stack>
      </Radio.Group>

      <Stack gap={6}>
        <Select
          size="xs"
          label="Overlay map"
          description="Drawn see-through over the background"
          placeholder="None"
          data={sources
            .filter((s) => s.id !== basemap.id)
            .map((s) => ({ value: s.id, label: s.label }))}
          value={settings.overlay}
          onChange={settings.setOverlay}
          clearable
          comboboxProps={{ withinPortal: true }}
        />
        {settings.overlay && (
          <Slider
            size="sm"
            min={0.1}
            max={1}
            step={0.05}
            value={settings.overlayOpacity}
            onChange={settings.setOverlayOpacity}
            label={(v) => `${Math.round(v * 100)} %`}
            aria-label="Overlay opacity"
          />
        )}
      </Stack>

      <Switch
        size="xs"
        label="Dim background map"
        description="For night use and dark rooms"
        checked={settings.dim}
        onChange={(e) => settings.setDim(e.currentTarget.checked)}
      />

      <Switch
        size="xs"
        label="MGRS grid"
        checked={settings.mgrsGrid}
        onChange={(e) => settings.setMgrsGrid(e.currentTarget.checked)}
      />

      <Switch
        size="xs"
        label="Show all tracks"
        description="Where moving users and units went in the last 2 hours"
        checked={settings.showAllTracks}
        onChange={(e) => settings.setShowAllTracks(e.currentTarget.checked)}
      />

      <Switch
        size="xs"
        label="Keep the TAK picture in this browser"
        description="The map opens with it and fetches only what's new. Off deletes the saved copy."
        checked={settings.savePicture}
        onChange={(e) => {
          const keep = e.currentTarget.checked;
          settings.setSavePicture(keep);
          void setPictureSaving(keep);
        }}
      />

      <Select
        size="xs"
        label="Coordinate format"
        data={Object.entries(COORD_FORMATS).map(([value, label]) => ({ value, label }))}
        value={settings.coordFormat}
        onChange={(value) => value && settings.setCoordFormat(value as CoordFormat)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />

      <GroupsSection clientUid={clientUid} />

      <SaveAreaSection map={map} source={basemap} />

      {map && (
        <Stack gap={6}>
          <Text className="tak-group-heading">Map image</Text>
          <Group gap={6}>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconPhoto size={14} />}
              onClick={() =>
                void mapImageBlob(map, settings.coordFormat).then(
                  (blob) => download(blob, `battlelog-map-${fileStamp()}.png`),
                  imageFailed,
                )
              }
            >
              Save as image
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconPrinter size={14} />}
              onClick={() =>
                void mapImageBlob(map, settings.coordFormat).then(printImage, imageFailed)
              }
            >
              Print
            </Button>
          </Group>
        </Stack>
      )}

      <MapSourcesSection settings={settings} />

      <IconsetsSection />

      {children}
    </Stack>
  );
};
