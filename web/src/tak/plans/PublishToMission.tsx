import {
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconFolderPlus } from "@tabler/icons-react";
import { useState } from "react";
import type { TakItem } from "../cot.ts";
import { labelOf } from "../items.ts";
import type { Mission } from "../missions/missions.ts";
import { canWriteAs, createMission, useSubscriptions } from "../missions/writes.ts";
import { notifyFailure } from "../notify.ts";
import { type Plan, publishPlanToMission } from "./plans.ts";

type Props = {
  plan: Plan;
  /** The plan's drafts as map items, to name the ones that didn't land. */
  drafts: TakItem[];
  missions: Mission[];
  clientUid: string;
  /** Why publishing is unavailable, or undefined when it is. */
  disabledReason: string | undefined;
};

type Target = "existing" | "new";

/** Publishes a plan to TAK and files its items in a mission, existing or new. */
export const PublishToMission = ({ plan, drafts, missions, clientUid, disabledReason }: Props) => {
  const [opened, setOpened] = useState(false);
  const [target, setTarget] = useState<Target>("existing");
  const [chosen, setChosen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const subscriptions = useSubscriptions();
  const writable = missions.filter((m) => {
    const subscription = subscriptions.get(m.name);
    // Password-protected missions refuse a subscribe from here.
    return subscription ? canWriteAs(subscription.role) : !m.passwordProtected;
  });
  const name = target === "new" ? newName.trim() : chosen;
  const invalidNewName = target === "new" && name?.includes("/");
  const labelFor = (uid: string) => {
    const item = drafts.find((d) => d.uid === uid);
    return item ? labelOf(item) : uid;
  };

  const publishInto = async () => {
    if (!name) return;
    setBusy(true);
    try {
      if (target === "new") await createMission(name, {}, clientUid);
      const mission = missions.find((m) => m.name === name) ?? { name, itemUids: [] };
      const { sent, kept, notInMission } = await publishPlanToMission(plan, mission, clientUid);
      setOpened(false);
      const unconfirmed = kept - notInMission.length;
      notifications.show(
        kept
          ? {
              color: "warning",
              title: `${plan.entries.length - kept} of ${plan.entries.length} published into ${name}`,
              message: [
                unconfirmed > 0 && `${unconfirmed} not confirmed by TAK.`,
                notInMission.length > 0 &&
                  `Sent but not filed in the feed: ${notInMission.map(labelFor).join(", ")}.`,
                "Those stay in the plan; publish again to retry.",
              ]
                .filter(Boolean)
                .join(" "),
            }
          : { color: "success", message: `Plan published into ${name}: ${sent} items sent to TAK` },
      );
    } catch (err) {
      notifyFailure(`Plan not published into ${name}`)(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="xs"
        variant="default"
        leftSection={<IconFolderPlus size={14} />}
        onClick={() => setOpened(true)}
        disabled={drafts.length === 0 || !!disabledReason}
        title={disabledReason}
      >
        Publish into a feed…
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={`Publish ${plan.name} into a Data Sync feed`}
        centered
      >
        <Stack gap="sm">
          <SegmentedControl
            size="xs"
            data={[
              { value: "existing", label: "Existing feed" },
              { value: "new", label: "New feed" },
            ]}
            value={target}
            onChange={(value) => setTarget(value as Target)}
          />
          {target === "existing" ? (
            <Select
              size="xs"
              label="Feed"
              placeholder={writable.length ? "Choose a feed" : "No feeds"}
              data={writable.map((m) => m.name)}
              value={chosen}
              onChange={setChosen}
              searchable
              comboboxProps={{ withinPortal: true }}
            />
          ) : (
            <TextInput
              size="xs"
              label="Name"
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
              error={invalidNewName ? "A name can't contain /" : undefined}
              data-autofocus
            />
          )}
          <Text fz="xs" c="dimmed">
            The items go to TAK as when publishing, then join the feed; staged deletes leave it.
            You're subscribed to the feed if you aren't yet.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              loading={busy}
              disabled={!name || invalidNewName}
              onClick={() => void publishInto()}
            >
              Publish {drafts.length}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
