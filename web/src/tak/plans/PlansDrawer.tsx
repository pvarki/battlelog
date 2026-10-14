import {
  ActionIcon,
  Badge,
  Button,
  FileButton,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconDownload, IconTrash, IconUpload } from "@tabler/icons-react";
import { useState } from "react";
import { formatDateTime } from "../../time.ts";
import { type RecipientGroup, SendTo } from "../contacts/SendTo.tsx";
import type { TakItem } from "../cot.ts";
import { download } from "../download.ts";
import type { Sender } from "../drawing/new-items.ts";
import { InboxSection } from "../inbox/InboxSection.tsx";
import { ItemRow } from "../items/ItemsDrawer.tsx";
import type { Mission } from "../missions/missions.ts";
import { sendPlan } from "../send.ts";
import { useNow } from "../use-now.ts";
import { kmlBlob } from "./overlay-files.ts";
import { PublishToMission } from "./PublishToMission.tsx";
import {
  createPlan,
  deletePlan,
  exportPlan,
  IMPORT_ACCEPT,
  importPlan,
  type Plan,
  type PlansState,
  publishPlan,
  removeFromPlan,
  renamePlan,
  setActivePlan,
} from "./plans.ts";

type Props = {
  state: PlansState;
  /** Drafts of a plan as map items, whether TAK changed the original since, and staged deletes. */
  draftsOf: (plan: Plan) => { item: TakItem; conflict: boolean; deleted: boolean }[];
  selectedUid: string | undefined;
  onPick: (item: TakItem) => void;
  /** Why publishing is unavailable, or undefined when it is. */
  publishReason: string | undefined;
  /** Named as the creator of drawings imported from overlay files, and the sender of plans sent to people. */
  sender: Sender;
  /** TAK users a plan can be sent to. */
  contacts: RecipientGroup[];
  missions: Mission[];
  /** Who this browser writes to TAK missions as; undefined without a callsign. */
  clientUid: string | undefined;
};

const PlanDetail = ({ plan, onBack, ...props }: Props & { plan: Plan; onBack: () => void }) => {
  const now = useNow(10_000);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const active = props.state.activeId === plan.id;
  const drafts = props.draftsOf(plan);
  const conflicts = drafts.filter((d) => d.conflict).length;

  const publishAll = async () => {
    setPublishing(true);
    const { sent, kept } = await publishPlan(plan);
    setPublishing(false);
    notifications.show(
      kept
        ? {
            color: "orange",
            title: `${sent} sent, ${kept} not confirmed`,
            message: "Those stay in the plan; publish again to retry.",
          }
        : { color: "teal", message: `Plan published: ${sent} items sent to TAK` },
    );
  };

  return (
    <Stack gap="xs" h="100%">
      <Group gap="xs" wrap="nowrap">
        <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label="Back to plans">
          <IconArrowLeft size={16} />
        </ActionIcon>
        <TextInput
          size="xs"
          style={{ flex: 1 }}
          aria-label="Plan name"
          defaultValue={plan.name}
          onBlur={(e) =>
            e.currentTarget.value.trim() && renamePlan(plan, e.currentTarget.value.trim())
          }
        />
      </Group>
      <Button
        size="xs"
        variant={active ? "filled" : "default"}
        onClick={() => setActivePlan(active ? undefined : plan.id)}
      >
        {active ? "Drawing into this plan — switch to Live" : "Draw and edit into this plan"}
      </Button>
      <Text fz="xs" c="dimmed">
        Stored in this browser only. Nothing reaches TAK until you publish.
      </Text>
      {conflicts > 0 && (
        <Text fz="xs" c="warning.4">
          {conflicts} item{conflicts > 1 ? "s" : ""} changed in TAK after you edited{" "}
          {conflicts > 1 ? "them" : "it"}; publishing overwrites those changes.
        </Text>
      )}
      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        {drafts.length === 0 ? (
          <Text fz="sm" c="dimmed" p="xs">
            Empty. Turn on "Draw and edit into this plan", then draw or edit items.
          </Text>
        ) : (
          drafts.map(({ item, conflict, deleted }) => (
            <Group key={item.uid} gap={4} wrap="nowrap">
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  textDecoration: deleted ? "line-through" : undefined,
                }}
              >
                <ItemRow
                  item={item}
                  now={now}
                  selected={item.uid === props.selectedUid}
                  onPick={() => props.onPick(item)}
                />
              </div>
              {deleted && (
                <Badge size="xs" color="danger" variant="outline">
                  Delete
                </Badge>
              )}
              {conflict && (
                <Badge size="xs" color="warning" variant="outline">
                  Changed
                </Badge>
              )}
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={`Remove ${item.callsign ?? item.uid} from the plan`}
                onClick={() => removeFromPlan(plan, item.uid)}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          ))
        )}
      </ScrollArea>
      <Stack gap={4}>
        <Button
          size="xs"
          onClick={() => void publishAll()}
          loading={publishing}
          disabled={drafts.length === 0 || !!props.publishReason}
          title={props.publishReason}
        >
          Publish {drafts.length} to TAK
        </Button>
        <Text fz="xs" c="dimmed">
          Everyone on TAK sees the items now, and they leave the plan.
        </Text>
      </Stack>
      {props.clientUid && (
        <Stack gap={4}>
          <PublishToMission
            plan={plan}
            drafts={drafts.map((d) => d.item)}
            missions={props.missions}
            clientUid={props.clientUid}
            disabledReason={props.publishReason}
          />
          <Text fz="xs" c="dimmed">
            Publishes them and files them in a mission, for those who follow it.
          </Text>
        </Stack>
      )}
      <Stack gap={4}>
        <SendTo
          what={plan.name}
          contacts={props.contacts}
          note="It arrives as a data package; the plan stays a draft here."
          disabledReason={drafts.length === 0 ? "The plan is empty" : props.publishReason}
          onSend={(callsigns) => sendPlan(plan, props.sender, callsigns)}
        />
        <Text fz="xs" c="dimmed">
          Only the people you pick get a copy to import; nothing is published.
        </Text>
      </Stack>
      <Group gap="xs" grow>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconDownload size={14} />}
          onClick={() => download(exportPlan(plan), `${plan.name}.zip`)}
          disabled={drafts.length === 0}
        >
          Export
        </Button>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconDownload size={14} />}
          onClick={() =>
            download(
              kmlBlob(
                plan.name,
                drafts.map((d) => d.item),
              ),
              `${plan.name}.kml`,
            )
          }
          disabled={drafts.length === 0}
        >
          KML
        </Button>
      </Group>
      <Button
        size="xs"
        variant="subtle"
        color="danger"
        leftSection={<IconTrash size={14} />}
        onClick={() => setDiscarding(true)}
      >
        Discard plan
      </Button>
      <Modal
        opened={discarding}
        onClose={() => setDiscarding(false)}
        title={`Discard ${plan.name}?`}
      >
        <Stack gap="sm">
          <Text fz="sm">
            {drafts.length === 0
              ? "The plan is empty."
              : `Its ${drafts.length} draft${drafts.length === 1 ? "" : "s"} exist only in this browser and can't be recovered.`}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDiscarding(false)}>
              Keep
            </Button>
            <Button color="danger" onClick={() => deletePlan(plan)}>
              Discard
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

/** Plans: drafts kept in this browser and published to TAK together. */
export const PlansDrawer = (props: Props) => {
  const [openId, setOpenId] = useState<string>();
  const open = props.state.plans.find((p) => p.id === openId);
  if (open) return <PlanDetail {...props} plan={open} onBack={() => setOpenId(undefined)} />;
  return (
    <Stack gap="xs" h="100%">
      <Group gap="xs" grow>
        <Button
          size="xs"
          onClick={() => setOpenId(createPlan(`Plan ${props.state.plans.length + 1}`).id)}
        >
          New plan
        </Button>
        <FileButton
          accept={IMPORT_ACCEPT}
          multiple
          onChange={(files) =>
            files.length > 0 &&
            importPlan(files, props.sender).then(
              (plan) => setOpenId(plan.id),
              (err) =>
                notifications.show({
                  color: "red",
                  title: "Couldn't import",
                  message: String(err),
                }),
            )
          }
        >
          {(p) => (
            <Button {...p} size="xs" variant="default" leftSection={<IconUpload size={14} />}>
              Import
            </Button>
          )}
        </FileButton>
      </Group>
      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        <InboxSection onOpenPlan={setOpenId} />
        {props.state.plans.length === 0 ? (
          <Text fz="sm" c="dimmed" p="xs">
            No plans. A plan collects drawings and changes in this browser and publishes them to TAK
            together; export one as a data package to move it to another computer or ATAK.
          </Text>
        ) : (
          props.state.plans.map((plan) => (
            <UnstyledButton key={plan.id} className="tak-row" onClick={() => setOpenId(plan.id)}>
              <Group gap={6} wrap="nowrap">
                <Text fz="sm" fw={600} truncate style={{ flex: 1 }}>
                  {plan.name}
                </Text>
                {props.state.activeId === plan.id && (
                  <Badge size="xs" variant="filled">
                    Active
                  </Badge>
                )}
              </Group>
              <Text fz="xs" c="dimmed">
                {plan.entries.length} items · edited {formatDateTime(plan.updated)}
              </Text>
            </UnstyledButton>
          ))
        )}
      </ScrollArea>
    </Stack>
  );
};
