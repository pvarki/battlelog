import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { IconFolderPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { TakItem } from "../cot.ts";
import { labelOf } from "../items.ts";
import { notifyFailure } from "./MissionsDrawer.tsx";
import type { Mission } from "./missions.ts";
import { addItem, loadSubscription, useSubscriptions } from "./writes.ts";

type Props = {
  item: TakItem;
  missions: Mission[];
  clientUid: string;
};

/** Adds the item to one of the missions this user is subscribed to, like ATAK's Data Sync. */
export const AddToMission = ({ item, missions, clientUid }: Props) => {
  const [opened, setOpened] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const subscriptions = useSubscriptions();
  const candidates = missions.filter((m) => !m.itemUids.includes(item.uid));
  const candidateKey = candidates.map((m) => m.name).join("\n");
  useEffect(() => {
    if (!opened) return;
    for (const name of candidateKey.split("\n")) {
      if (name) void loadSubscription(name, clientUid).catch(() => undefined);
    }
  }, [opened, candidateKey, clientUid]);

  const options = candidates.map((m) => {
    const token = subscriptions.get(m.name);
    const subscribed = typeof token === "string";
    return {
      value: m.name,
      label: subscribed ? m.name : `${m.name} (subscribe first)`,
      disabled: !subscribed,
    };
  });

  const add = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await addItem(chosen, item.uid, clientUid);
      setOpened(false);
      setChosen(null);
    } catch (err) {
      notifyFailure(`${labelOf(item)} not added to ${chosen}`)(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="default"
        size="xs"
        leftSection={<IconFolderPlus size={14} />}
        onClick={() => setOpened(true)}
      >
        Add to mission…
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={`Add ${labelOf(item)} to a mission`}
        centered
      >
        <Stack gap="sm">
          <Select
            size="xs"
            label="Mission"
            placeholder={candidates.length ? "Choose a mission" : "No other missions"}
            data={options}
            value={chosen}
            onChange={setChosen}
            searchable
            comboboxProps={{ withinPortal: true }}
          />
          <Text fz="xs" c="dimmed">
            Only missions you're subscribed to take items: TAK ignores changes from users who
            aren't. Subscribe in the Missions drawer.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button size="xs" loading={busy} disabled={!chosen} onClick={() => void add()}>
              Add
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
