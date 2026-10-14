import {
  Button,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import type { MissionRole } from "./missions.ts";
import { roleOptions, useWrite } from "./shared.tsx";
import { createMission } from "./writes.ts";

export const NewMission = ({
  clientUid,
  onCreated,
}: {
  clientUid: string | undefined;
  onCreated: (name: string) => void;
}) => {
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultRole, setDefaultRole] = useState<MissionRole>("MISSION_SUBSCRIBER");
  const [inviteOnly, setInviteOnly] = useState(false);
  const [password, setPasswordText] = useState("");
  const { busy, run } = useWrite();
  const trimmed = name.trim();
  const create = async () => {
    if (!clientUid) return;
    const settings = {
      description: description.trim(),
      defaultRole,
      inviteOnly,
      password: password || undefined,
    };
    if (await run("Feed not created", () => createMission(trimmed, settings, clientUid))) {
      setOpened(false);
      setName("");
      setDescription("");
      setDefaultRole("MISSION_SUBSCRIBER");
      setInviteOnly(false);
      setPasswordText("");
      onCreated(trimmed);
    }
  };
  return (
    <>
      <Tooltip
        label="No callsign: open BattleLog from the deploy app to create feeds"
        disabled={!!clientUid}
        withArrow
      >
        <Button
          size="xs"
          variant="default"
          leftSection={<IconPlus size={14} />}
          disabled={!clientUid}
          onClick={() => setOpened(true)}
        >
          New feed
        </Button>
      </Tooltip>
      <Modal opened={opened} onClose={() => setOpened(false)} title="New feed" centered>
        <Stack gap="sm">
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={trimmed.includes("/") ? "A name can't contain /" : undefined}
            data-autofocus
          />
          <Textarea
            label="Description"
            autosize
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <Select
            label="New subscribers join as"
            data={roleOptions}
            value={defaultRole}
            onChange={(value) => value && setDefaultRole(value as MissionRole)}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
          />
          <PasswordInput
            label="Password"
            description="Optional: subscribers must enter it to join"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPasswordText(e.currentTarget.value)}
          />
          <Switch
            label="Invite-only"
            description="Hidden from other users until you invite them"
            checked={inviteOnly}
            onChange={(e) => setInviteOnly(e.currentTarget.checked)}
          />
          <Text fz="xs" c="dimmed">
            {inviteOnly
              ? "Only the users you invite can see and join it"
              : "Everyone on TAK can see it"}
            ; you're its owner and can delete it later.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              loading={busy}
              disabled={!trimmed || trimmed.includes("/")}
              onClick={() => void create()}
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
