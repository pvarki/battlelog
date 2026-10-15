import {
  ActionIcon,
  Box,
  Button,
  ColorSwatch,
  Group,
  Menu,
  Progress,
  ScrollArea,
  Slider,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  IconCheck,
  IconDots,
  IconDownload,
  IconPencil,
  IconPlus,
  IconStack2,
  IconTrash,
} from "@tabler/icons-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useState } from "react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { LayerDialog } from "../event-layers/LayerDialog.tsx";
import type { EventLayer } from "../event-layers/layers.ts";
import { DEFAULT_BASEMAP, type MapSource } from "../map/basemaps.ts";
import { canSaveArea } from "../map/offline-area.ts";
import { removeOfflineMap } from "../map/offline-maps.ts";
import { PanelActions, PanelFooter, PanelMenu, ToggleRow, ViewOption } from "../panel.tsx";
import type { MapSettings } from "../settings.ts";
import { AddMapDialog } from "./AddMapDialog.tsx";
import { useSaveArea } from "./save-area.ts";

type Props = {
  settings: MapSettings;
  sources: MapSource[];
  /** The map on screen, for saving the visible area offline. */
  map?: MapLibreMap;
  basemap: MapSource;
  /** The shared BattleLog layers; null while loading. */
  eventLayers: EventLayer[] | null;
  /** Layers that hit the fetch limit, so some events aren't drawn. */
  truncated: ReadonlySet<string>;
};

const ORIGIN_NOTE: Partial<Record<MapSource["origin"], string>> = {
  tak: "From TAK",
  offline: "Offline",
};

/** What the map shows: BattleLog layers and the grid over it, and the background maps under it. */
export const LayersDrawer = ({
  settings,
  sources,
  map,
  basemap,
  eventLayers,
  truncated,
}: Props) => {
  const [editing, setEditing] = useState<{ layer?: EventLayer }>();
  const [addingMap, setAddingMap] = useState(false);
  const saving = useSaveArea(map);
  const shown = settings.shownEventLayers;

  const remove = (source: MapSource) => {
    if (settings.basemap === source.id) settings.setBasemap(DEFAULT_BASEMAP);
    if (settings.overlay === source.id) settings.setOverlay(null);
    if (source.origin === "offline") void removeOfflineMap(source);
    else settings.setCustomSources((list) => list.filter((s) => s.id !== source.id));
  };

  return (
    <Stack gap="xs" h="100%">
      <PanelActions>
        <PanelMenu>
          <ViewOption checked={settings.dim} onChange={settings.setDim}>
            Dim background map
          </ViewOption>
        </PanelMenu>
      </PanelActions>
      <ScrollArea style={{ flex: 1 }} offsetScrollbars="present">
        <Stack gap="md">
          <Stack gap={2}>
            <SectionHeading>On the map</SectionHeading>
            {eventLayers === null && (
              <Text fz="xs" c="dimmed" px={6}>
                Loading BattleLog layers…
              </Text>
            )}
            {eventLayers?.map((layer) => (
              <ToggleRow
                key={layer.eventId}
                label={
                  <Group gap={6} wrap="nowrap" component="span">
                    <ColorSwatch
                      size={9}
                      color={`var(--mantine-color-${layer.definition.color}-5)`}
                    />
                    <span>{layer.definition.name || "(unnamed)"}</span>
                  </Group>
                }
                hint="A BattleLog layer, shared with everyone"
                warning={
                  truncated.has(layer.eventId) && shown.has(layer.eventId)
                    ? "Too many events: only the newest are shown"
                    : undefined
                }
                checked={shown.has(layer.eventId)}
                onChange={() => settings.toggleEventLayer(layer.eventId)}
              >
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Edit layer ${layer.definition.name}`}
                  onClick={() => setEditing({ layer })}
                >
                  <IconPencil size={16} />
                </ActionIcon>
              </ToggleRow>
            ))}
            <ToggleRow
              label="MGRS grid"
              checked={settings.mgrsGrid}
              onChange={() => settings.setMgrsGrid(!settings.mgrsGrid)}
            />
            <ToggleRow
              label="Tracks"
              hint="Where moving users and units went in the last 2 hours"
              checked={settings.showAllTracks}
              onChange={() => settings.setShowAllTracks(!settings.showAllTracks)}
            />
          </Stack>

          <Stack gap={2}>
            <SectionHeading>Background map</SectionHeading>
            <div role="radiogroup" aria-label="Background map">
              {sources.map((source) => (
                <MapRow
                  key={source.id}
                  source={source}
                  settings={settings}
                  isBasemap={source.id === basemap.id}
                  canSave={!!map && canSaveArea(source) && source.origin !== "offline"}
                  onSave={() => void saving.start(source)}
                  onRemove={() => remove(source)}
                />
              ))}
            </div>
            {saving.progress && (
              <Stack gap={4} px={6} pt={4}>
                <Text fz="xs" c="dimmed">
                  Saving this area of {saving.progress.source.label}…
                </Text>
                <Group gap="xs" wrap="nowrap">
                  <Progress
                    value={(saving.progress.done / saving.progress.total) * 100}
                    style={{ flex: 1 }}
                  />
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={saving.cancel}>
                    Cancel
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        </Stack>
      </ScrollArea>
      <PanelFooter>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconPlus size={14} />}
          title="A layer puts the log's events with a position on the map, e.g. every drone sighting of the last 24 hours"
          onClick={() => setEditing({})}
        >
          New layer
        </Button>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconPlus size={14} />}
          onClick={() => setAddingMap(true)}
        >
          Add map
        </Button>
      </PanelFooter>
      {editing && (
        <LayerDialog
          layer={editing.layer}
          onClose={() => setEditing(undefined)}
          onSaved={(eventId) => {
            if (!editing.layer && eventId && !shown.has(eventId))
              settings.toggleEventLayer(eventId);
          }}
        />
      )}
      <AddMapDialog settings={settings} opened={addingMap} onClose={() => setAddingMap(false)} />
    </Stack>
  );
};

const MapRow = ({
  source,
  settings,
  isBasemap,
  canSave,
  onSave,
  onRemove,
}: {
  source: MapSource;
  settings: MapSettings;
  isBasemap: boolean;
  canSave: boolean;
  onSave: () => void;
  onRemove: () => void;
}) => {
  const isOverlay = settings.overlay === source.id && !isBasemap;
  const removable = source.origin === "custom" || source.origin === "offline";
  const note = isOverlay
    ? `Overlay ${Math.round(settings.overlayOpacity * 100)} %`
    : ORIGIN_NOTE[source.origin];
  return (
    <>
      <Group className="tak-row" gap={6} wrap="nowrap" data-selected={isBasemap || undefined}>
        <UnstyledButton
          role="radio"
          aria-checked={isBasemap}
          onClick={() => settings.setBasemap(source.id)}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Group gap={6} wrap="nowrap">
            <Text fz="sm" truncate style={{ flex: 1 }}>
              {source.label}
            </Text>
            {note && (
              <Text fz="xs" c={isOverlay ? undefined : "dimmed"}>
                {note}
              </Text>
            )}
            {isBasemap && <IconCheck size={14} />}
          </Group>
        </UnstyledButton>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={`More for ${source.label}`}
            >
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<IconStack2 size={14} />}
              disabled={isBasemap}
              title={
                isBasemap ? "It's the background map" : "Drawn see-through over the background"
              }
              onClick={() => settings.setOverlay(isOverlay ? null : source.id)}
            >
              {isOverlay ? "Stop showing over the background" : "Show over the background"}
            </Menu.Item>
            {canSave && (
              <Menu.Item
                leftSection={<IconDownload size={14} />}
                title="Maps you view stay in this browser; this keeps what's on screen, a few zoom levels deeper, for use offline"
                onClick={onSave}
              >
                Save this area offline
              </Menu.Item>
            )}
            {removable && (
              <>
                <Menu.Divider />
                <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={onRemove}>
                  Remove map
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
      {isOverlay && (
        <Box pl={12} pr={36} py={6}>
          <Slider
            size="sm"
            min={0.1}
            max={1}
            step={0.05}
            value={settings.overlayOpacity}
            onChange={settings.setOverlayOpacity}
            label={(v) => `${Math.round(v * 100)} %`}
            aria-label={`${source.label} opacity`}
          />
        </Box>
      )}
    </>
  );
};
