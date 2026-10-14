import { Button, Group, Modal, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import { useState } from "react";
import type { Mission } from "./missions.ts";
import { useWrite } from "./shared.tsx";
import { copyMission } from "./writes.ts";

export const CopyMission = ({
  mission,
  clientUid,
  disabled,
  onCopied,
}: {
  mission: Mission;
  clientUid: string;
  disabled: boolean;
  onCopied: (name: string) => void;
}) => {
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");
  const [password, setPasswordText] = useState("");
  const { busy, run } = useWrite();
  const trimmed = name.trim();
  const open = () => {
    setName(`${mission.name} copy`);
    setPasswordText("");
    setOpened(true);
  };
  const copy = async () => {
    const done = await run("Feed not copied", () =>
      copyMission(mission, trimmed, clientUid, password || undefined),
    );
    if (!done) return;
    setOpened(false);
    onCopied(trimmed);
  };
  return (
    <>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconCopy size={14} />}
        disabled={disabled}
        onClick={open}
      >
        Copy feed
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Copy feed" centered>
        <Stack gap="sm">
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={trimmed.includes("/") ? "A name can't contain /" : undefined}
            data-autofocus
          />
          <PasswordInput
            label="Password"
            description={
              mission.passwordProtected
                ? "The original's password isn't copied: set one to keep the copy closed"
                : "Optional: subscribers must enter it to join"
            }
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPasswordText(e.currentTarget.value)}
          />
          <Text fz="xs" c="dimmed">
            The copy starts with this feed's items and files; you're its owner.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              loading={busy}
              disabled={!trimmed || trimmed.includes("/")}
              onClick={() => void copy()}
            >
              Copy
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
