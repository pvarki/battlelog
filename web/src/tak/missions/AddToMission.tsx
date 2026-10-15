import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { TakItem } from "../cot.ts";
import { labelOf } from "../items.ts";
import { notifyFailure } from "../notify.ts";
import type { Mission } from "./missions.ts";
import { addItem, canWriteAs, loadSubscription, useSubscriptions } from "./writes.ts";

type Props = {
  item: TakItem;
  missions: Mission[];
  clientUid: string;
  opened: boolean;
  onClose: () => void;
};

/** Adds the item to one of the missions this user is subscribed to, like ATAK's Data Sync. */
export const AddToMission = ({ item, missions, clientUid, opened, onClose }: Props) => {
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
    const subscription = subscriptions.get(m.name);
    const why = !subscription
      ? " (subscribe first)"
      : canWriteAs(subscription.role)
        ? ""
        : " (read-only)";
    return { value: m.name, label: m.name + why, disabled: !!why };
  });

  const add = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await addItem(chosen, item.uid, clientUid);
      onClose();
      setChosen(null);
    } catch (err) {
      notifyFailure(`${labelOf(item)} not added to ${chosen}`)(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Add ${labelOf(item)} to a Data Sync feed`}
      centered
    >
      <Stack gap="sm">
        <Select
          size="xs"
          label="Feed"
          placeholder={candidates.length ? "Choose a feed" : "No other feeds"}
          data={options}
          value={chosen}
          onChange={setChosen}
          searchable
          comboboxProps={{ withinPortal: true }}
        />
        <Text fz="xs" c="dimmed">
          Only feeds you're subscribed to take items: TAK ignores changes from users who aren't.
          Subscribe in Data Sync.
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button size="xs" loading={busy} disabled={!chosen} onClick={() => void add()}>
            Add
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
