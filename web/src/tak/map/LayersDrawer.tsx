import { ActionIcon, Group, Radio, Select, Slider, Stack, Switch } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { ReactNode } from "react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import type { MapSettings } from "../settings.ts";
import { DEFAULT_BASEMAP, type MapSource } from "./basemaps.ts";
import { MapSourcesSection } from "./MapSourcesSection.tsx";
import { removeOfflineMap } from "./offline-maps.ts";
import { SaveAreaSection } from "./SaveAreaSection.tsx";

type Props = {
  settings: MapSettings;
  sources: MapSource[];
  /** The map on screen and its background, for saving the visible area offline. */
  map?: MapLibreMap;
  basemap: MapSource;
  /** The BattleLog layers section. */
  eventLayers: ReactNode;
};

/** What the map shows: BattleLog layers, the background and what's drawn over it, and maps to add. */
export const LayersDrawer = ({ settings, sources, map, basemap, eventLayers }: Props) => {
  const remove = (source: MapSource) => {
    if (settings.basemap === source.id) settings.setBasemap(DEFAULT_BASEMAP);
    if (settings.overlay === source.id) settings.setOverlay(null);
    if (source.origin === "offline") void removeOfflineMap(source);
    else settings.setCustomSources((list) => list.filter((s) => s.id !== source.id));
  };

  return (
    <Stack gap="md">
      {eventLayers}

      <Stack gap="sm">
        <SectionHeading>Background map</SectionHeading>
        <Radio.Group value={basemap.id} onChange={settings.setBasemap} aria-label="Background map">
          <Stack gap={6}>
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
      </Stack>

      <Stack gap="sm">
        <SectionHeading>Grid and tracks</SectionHeading>
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
      </Stack>

      <SaveAreaSection map={map} source={basemap} />

      <MapSourcesSection settings={settings} />
    </Stack>
  );
};
