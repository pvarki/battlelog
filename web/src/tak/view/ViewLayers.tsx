import { ActionIcon, Checkbox, Popover, Radio, Stack, Text } from "@mantine/core";
import { IconStack2 } from "@tabler/icons-react";
import type { EventLayer } from "../event-layers/layers.ts";
import type { MapSource } from "../map/basemaps.ts";
import { GROUP_LABEL, hiddenExcept, isHidden } from "../overlays.ts";
import { TOGGLED_GROUPS } from "../view-options.ts";

type Props = {
  sources: MapSource[];
  basemap: MapSource;
  onBasemap: (id: string) => void;
  hidden: ReadonlySet<string>;
  onHidden: (hidden: ReadonlySet<string>) => void;
  layers: EventLayer[];
  shownLayers: ReadonlySet<string>;
  onShownLayers: (shown: ReadonlySet<string>) => void;
};

const GROUP_KEYS = Object.keys(GROUP_LABEL);
const isLeaf = (key: string) => !GROUP_KEYS.some((other) => other.startsWith(`${key}/`));
const shownOf = (key: string, hidden: ReadonlySet<string>) => !isHidden(key.split("/"), hidden);

/**
 * Hidden groups after switching `key` and everything under it. Built from the
 * leaves left shown: a hidden parent would otherwise keep a re-shown child hidden.
 */
export const toggledGroup = (hidden: ReadonlySet<string>, key: string): Set<string> => {
  const under = (k: string) => k === key || k.startsWith(`${key}/`);
  const leaves = GROUP_KEYS.filter((k) => isLeaf(k) && shownOf(k, hidden));
  const next = shownOf(key, hidden)
    ? leaves.filter((k) => !under(k))
    : [...leaves, ...GROUP_KEYS.filter((k) => isLeaf(k) && under(k))];
  return hiddenExcept(next);
};

const toggled = <T,>(set: ReadonlySet<T>, value: T) => {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
};

/** A viewer's own changes to what a map view shows; they last until the page is left. */
export const ViewLayers = ({
  sources,
  basemap,
  onBasemap,
  hidden,
  onHidden,
  layers,
  shownLayers,
  onShownLayers,
}: Props) => (
  <Popover position="left-start" shadow="md" withinPortal>
    <Popover.Target>
      <ActionIcon variant="default" size="md" aria-label="Layers" title="Layers">
        <IconStack2 size={18} />
      </ActionIcon>
    </Popover.Target>
    <Popover.Dropdown maw={260} mah={420} style={{ overflowY: "auto" }}>
      <Stack gap="sm">
        <Text fz="xs" c="dimmed">
          Your changes here last until you leave the page.
        </Text>
        <Radio.Group label="Background map" value={basemap.id} onChange={onBasemap} size="xs">
          <Stack gap={4} mt={4}>
            {sources.map((s) => (
              <Radio key={s.id} value={s.id} label={s.label} size="xs" />
            ))}
          </Stack>
        </Radio.Group>
        <Stack gap={4}>
          <Text fz="sm" fw={500}>
            TAK
          </Text>
          {TOGGLED_GROUPS.map((key) => (
            <Checkbox
              key={key}
              size="xs"
              label={GROUP_LABEL[key]}
              checked={shownOf(key, hidden)}
              onChange={() => onHidden(toggledGroup(hidden, key))}
            />
          ))}
        </Stack>
        {layers.length > 0 && (
          <Stack gap={4}>
            <Text fz="sm" fw={500}>
              BattleLog
            </Text>
            {layers.map((layer) => (
              <Checkbox
                key={layer.eventId}
                size="xs"
                label={layer.definition.name || "(unnamed)"}
                checked={shownLayers.has(layer.eventId)}
                onChange={() => onShownLayers(toggled(shownLayers, layer.eventId))}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Popover.Dropdown>
  </Popover>
);
