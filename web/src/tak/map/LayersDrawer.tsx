import { ActionIcon, Group, Radio, Select, Slider, Stack, Switch, Text } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { COORD_FORMATS, type CoordFormat } from "../coords.ts";
import type { MapSettings } from "../settings.ts";
import { DEFAULT_BASEMAP, type MapSource } from "./basemaps.ts";
import { IconsetsSection } from "./IconsetsSection.tsx";
import { MapSourcesSection } from "./MapSourcesSection.tsx";
import { removeOfflineMap } from "./offline-maps.ts";

type Props = {
  settings: MapSettings;
  sources: MapSource[];
  /** Developer tools; only passed in dev builds. */
  children?: ReactNode;
};

const Heading = ({ children }: { children: ReactNode }) => (
  <Text className="tak-group-heading">{children}</Text>
);

export const LayersDrawer = ({ settings, sources, children }: Props) => {
  const remove = (source: MapSource) => {
    if (settings.basemap === source.id) settings.setBasemap(DEFAULT_BASEMAP);
    if (settings.overlay === source.id) settings.setOverlay(null);
    if (source.origin === "offline") void removeOfflineMap(source);
    else settings.setCustomSources((list) => list.filter((s) => s.id !== source.id));
  };

  return (
    <Stack gap="md">
      <Radio.Group
        label={<Heading>Background map</Heading>}
        value={settings.basemap}
        onChange={settings.setBasemap}
      >
        <Stack gap={6} mt={6}>
          {sources.map((source) => (
            <Group key={source.id} gap="xs" wrap="nowrap" justify="space-between">
              <Radio size="xs" value={source.id} label={source.label} />
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
            .filter((s) => s.id !== settings.basemap)
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

      <Select
        size="xs"
        label="Coordinate format"
        data={Object.entries(COORD_FORMATS).map(([value, label]) => ({ value, label }))}
        value={settings.coordFormat}
        onChange={(value) => value && settings.setCoordFormat(value as CoordFormat)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />

      <MapSourcesSection settings={settings} />

      <IconsetsSection />

      {children}
    </Stack>
  );
};
