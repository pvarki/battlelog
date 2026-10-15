import { Menu, Select, Stack, Switch } from "@mantine/core";
import { useFileDialog } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconDownload, IconUpload } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { SectionHeading } from "../components/SectionHeading.tsx";
import { applySettings, readSettingsFile, settingsFile } from "../settings-file.ts";
import { COORD_FORMATS, type CoordFormat } from "./coords.ts";
import { download } from "./download.ts";
import { ShortcutsSection } from "./keys/ShortcutsSection.tsx";
import { GroupsSection } from "./map/GroupsSection.tsx";
import { IconsetsSection } from "./map/IconsetsSection.tsx";
import { PanelActions, PanelMenu } from "./panel.tsx";
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
export const SettingsDrawer = ({ settings, clientUid, children }: Props) => {
  const [importing, setImporting] = useState<Record<string, string>>();
  const importDialog = useFileDialog({
    accept: ".json,application/json",
    multiple: false,
    resetOnOpen: true,
    onChange: (files) => {
      files?.[0]
        ?.text()
        .then((text) => setImporting(readSettingsFile(text)))
        .catch((err) =>
          notifications.show({
            color: "danger",
            title: "Couldn't import",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
    },
  });

  return (
    <Stack gap="md">
      <PanelActions>
        <PanelMenu>
          <Menu.Item
            leftSection={<IconDownload size={14} />}
            title="Shortcuts, map choices and the rest of this browser's BattleLog settings"
            onClick={() =>
              download(
                new Blob([settingsFile(localStorage)], { type: "application/json" }),
                "battlelog-settings.json",
              )
            }
          >
            Export settings
          </Menu.Item>
          <Menu.Item leftSection={<IconUpload size={14} />} onClick={importDialog.open}>
            Import settings…
          </Menu.Item>
        </PanelMenu>
      </PanelActions>
      <ConfirmDialog
        opened={!!importing}
        onClose={() => setImporting(undefined)}
        title="Import settings?"
        confirmLabel="Import and reload"
        onConfirm={() => {
          if (importing) applySettings(localStorage, importing);
          location.reload();
        }}
      >
        The file's {Object.keys(importing ?? {}).length} settings replace this browser's, and the
        page reloads to use them.
      </ConfirmDialog>

      <Stack gap="sm">
        <SectionHeading>General</SectionHeading>
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

      <ShortcutsSection />

      <GroupsSection clientUid={clientUid} />

      <IconsetsSection />

      {children}
    </Stack>
  );
};
