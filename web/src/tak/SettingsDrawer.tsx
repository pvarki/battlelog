import { ActionIcon, Group, Menu, Select, Stack, Text, UnstyledButton } from "@mantine/core";
import { useFileDialog } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAdjustments,
  IconArrowLeft,
  IconChevronRight,
  IconDownload,
  IconIcons,
  IconKeyboard,
  IconUpload,
  IconUsersGroup,
} from "@tabler/icons-react";
import { type ComponentType, type ReactNode, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { SectionHeading } from "../components/SectionHeading.tsx";
import { applySettings, readSettingsFile, settingsFile } from "../settings-file.ts";
import { COORD_FORMATS, type CoordFormat } from "./coords.ts";
import { download } from "./download.ts";
import { ShortcutsSection } from "./keys/ShortcutsSection.tsx";
import { useKeymap } from "./keys/useKeymap.ts";
import { GroupsSection } from "./map/GroupsSection.tsx";
import { IconsetsSection } from "./map/IconsetsSection.tsx";
import { useIconsets } from "./map/iconsets.ts";
import { PanelActions, PanelMenu, SettingRow, ToggleRow } from "./panel.tsx";
import { setPictureSaving } from "./session.ts";
import type { MapSettings } from "./settings.ts";

type Props = {
  settings: MapSettings;
  /** This connection's uid on TAK; undefined without a callsign. */
  clientUid: string | undefined;
  /** Developer tools; only passed in dev builds. */
  children?: ReactNode;
  /** The page open, or undefined for the index. */
  page: SettingsPage | undefined;
  onPage: (page: SettingsPage | undefined) => void;
};

export type SettingsPage = "general" | "groups" | "iconsets" | "shortcuts";

const PAGES: Record<
  SettingsPage,
  { title: string; detail: string; Icon: ComponentType<{ size?: number }> }
> = {
  general: {
    title: "General",
    detail: "Coordinates and the saved picture",
    Icon: IconAdjustments,
  },
  groups: {
    title: "TAK groups",
    detail: "Who you send to and receive from",
    Icon: IconUsersGroup,
  },
  iconsets: { title: "Icon sets", detail: "ATAK icons for markers", Icon: IconIcons },
  shortcuts: {
    title: "Keyboard shortcuts",
    detail: "Keys for the map's actions",
    Icon: IconKeyboard,
  },
};

const General = ({ settings }: { settings: MapSettings }) => (
  <Stack gap={2}>
    <SettingRow label="Coordinate format" hint="How positions are shown and typed">
      <Select
        size="xs"
        w={190}
        aria-label="Coordinate format"
        data={Object.entries(COORD_FORMATS).map(([value, label]) => ({ value, label }))}
        value={settings.coordFormat}
        onChange={(value) => value && settings.setCoordFormat(value as CoordFormat)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
    </SettingRow>
    <ToggleRow
      label="Keep the TAK picture in this browser"
      hint="The map opens with it and fetches only what's new. Off deletes the saved copy."
      checked={settings.savePicture}
      onChange={() => {
        const keep = !settings.savePicture;
        settings.setSavePicture(keep);
        void setPictureSaving(keep);
      }}
    />
  </Stack>
);

/** How this browser's TAK client behaves: an index of settings pages, each opened on its own. */
export const SettingsDrawer = ({ settings, clientUid, children, page, onPage: setPage }: Props) => {
  const [importing, setImporting] = useState<Record<string, string>>();
  const { overrides } = useKeymap();
  const { sets } = useIconsets();
  const changedKeys = Object.keys(overrides).length;
  const summary: Record<SettingsPage, string> = {
    general: COORD_FORMATS[settings.coordFormat],
    groups: "",
    iconsets: sets.length ? `${sets.length} imported` : "None",
    shortcuts: changedKeys ? `${changedKeys} changed` : "Defaults",
  };

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
            title="Shortcuts, map choices and the rest of this browser's BattleLog settings; not sign-ins"
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

      {page ? (
        <Stack gap="sm">
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={() => setPage(undefined)}
              aria-label="Back to settings"
            >
              <IconArrowLeft size={16} />
            </ActionIcon>
            <Text fw={600} fz="sm">
              {PAGES[page].title}
            </Text>
          </Group>
          {page === "general" && <General settings={settings} />}
          {page === "groups" && <GroupsSection clientUid={clientUid} />}
          {page === "iconsets" && <IconsetsSection />}
          {page === "shortcuts" && <ShortcutsSection />}
        </Stack>
      ) : (
        <Stack gap={2}>
          {(Object.keys(PAGES) as SettingsPage[]).map((id) => {
            const { title, detail, Icon } = PAGES[id];
            return (
              <UnstyledButton key={id} className="tak-row" onClick={() => setPage(id)}>
                <Group gap="sm" wrap="nowrap">
                  <Icon size={16} />
                  <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                    <Text fz="sm">{title}</Text>
                    <Text fz="xs" c="dimmed" truncate>
                      {detail}
                    </Text>
                  </Stack>
                  {summary[id] && (
                    <Text fz="xs" c="dimmed">
                      {summary[id]}
                    </Text>
                  )}
                  <IconChevronRight size={14} />
                </Group>
              </UnstyledButton>
            );
          })}
        </Stack>
      )}

      {!page && children && (
        <Stack gap={6}>
          <SectionHeading>Developer</SectionHeading>
          {children}
        </Stack>
      )}
    </Stack>
  );
};
