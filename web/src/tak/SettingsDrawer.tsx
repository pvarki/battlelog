import { Select, Stack, Switch, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { COORD_FORMATS, type CoordFormat } from "./coords.ts";
import { GroupsSection } from "./map/GroupsSection.tsx";
import { IconsetsSection } from "./map/IconsetsSection.tsx";
import { setPictureSaving } from "./session.ts";
import type { MapSettings } from "./settings.ts";

type Props = {
  settings: MapSettings;
  /** This connection's uid on TAK; undefined without a callsign. */
  clientUid: string | undefined;
  /** Developer tools; only passed in dev builds. */
  children?: ReactNode;
};

/** How this browser's TAK client behaves: settings that aren't about what the map shows. */
export const SettingsDrawer = ({ settings, clientUid, children }: Props) => (
  <Stack gap="md">
    <Stack gap="sm">
      <Text className="tak-group-heading">General</Text>
      <Select
        size="xs"
        label="Coordinate format"
        data={Object.entries(COORD_FORMATS).map(([value, label]) => ({ value, label }))}
        value={settings.coordFormat}
        onChange={(value) => value && settings.setCoordFormat(value as CoordFormat)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
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
    </Stack>

    <GroupsSection clientUid={clientUid} />

    <IconsetsSection />

    {children}
  </Stack>
);
