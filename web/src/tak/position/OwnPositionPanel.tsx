import { Alert, Group, Select, Stack, Switch, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { TEAMS } from "../items.ts";
import type { MapSettings } from "../settings.ts";
import { ROLES } from "./self-sa.ts";

type Props = {
  settings: MapSettings;
  /** Why sharing is unavailable, or undefined when it is. */
  shareReason: string | undefined;
  error: string | undefined;
};

/** Whether, and as whom, this browser reports its position to TAK. */
export const OwnPositionPanel = ({ settings, shareReason, error }: Props) => (
  <Stack gap={6}>
    <Switch
      size="sm"
      label="Share my position"
      description={
        shareReason ??
        "While on, everyone on TAK sees where you are, as with an ATAK device. Only this browser shares."
      }
      checked={settings.sharePosition && !shareReason}
      disabled={!!shareReason}
      onChange={(e) => settings.setSharePosition(e.currentTarget.checked)}
    />
    {settings.sharePosition && !shareReason && (
      <Group gap="xs" grow>
        <Select
          size="xs"
          label="Team"
          data={TEAMS}
          value={settings.team}
          onChange={(team) => team && settings.setTeam(team)}
          allowDeselect={false}
        />
        <Select
          size="xs"
          label="Role"
          data={ROLES}
          value={settings.role}
          onChange={(role) => role && settings.setRole(role)}
          allowDeselect={false}
        />
      </Group>
    )}
    {error && (
      <Alert color="warning" variant="light" p={6} icon={<IconAlertTriangle size={16} />}>
        <Text fz="xs">Location unavailable: {error}</Text>
      </Alert>
    )}
  </Stack>
);
