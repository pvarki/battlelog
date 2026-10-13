import { Checkbox, Radio, Select, Stack, Switch, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { COORD_FORMATS, type CoordFormat } from "../coords.ts";
import type { TakItem } from "../cot.ts";
import { CATEGORIES, type Category, categoryOf } from "../items.ts";
import type { MapSettings } from "../settings.ts";
import { BASEMAPS, type Basemap } from "./basemaps.ts";

type Props = {
  items: TakItem[];
  settings: MapSettings;
  /** Developer tools; only passed in dev builds. */
  children?: ReactNode;
};

const Heading = ({ children }: { children: ReactNode }) => (
  <Text className="tak-group-heading">{children}</Text>
);

export const LayersDrawer = ({ items, settings, children }: Props) => {
  const counts = new Map<Category, number>();
  for (const item of items) counts.set(categoryOf(item), (counts.get(categoryOf(item)) ?? 0) + 1);

  return (
    <Stack gap="md">
      <div>
        <Heading>On the map</Heading>
        <Stack gap={6} mt={6}>
          {(Object.keys(CATEGORIES) as Category[]).map((category) => (
            <Checkbox
              key={category}
              size="xs"
              label={`${CATEGORIES[category]} (${counts.get(category) ?? 0})`}
              checked={!settings.hidden.has(category)}
              onChange={() => settings.toggleCategory(category)}
            />
          ))}
        </Stack>
      </div>

      <Radio.Group
        label={<Heading>Background map</Heading>}
        value={settings.basemap}
        onChange={(value) => settings.setBasemap(value as Basemap)}
      >
        <Stack gap={6} mt={6}>
          {(Object.keys(BASEMAPS) as Basemap[]).map((key) => (
            <Radio key={key} size="xs" value={key} label={BASEMAPS[key].label} />
          ))}
        </Stack>
      </Radio.Group>

      <Switch
        size="xs"
        label="Dim background map"
        description="For night use and dark rooms"
        checked={settings.dim}
        onChange={(e) => settings.setDim(e.currentTarget.checked)}
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

      {children}
    </Stack>
  );
};
