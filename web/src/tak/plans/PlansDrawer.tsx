import {
  ActionIcon,
  Badge,
  Button,
  FileButton,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowLeft, IconDownload, IconTrash, IconUpload } from "@tabler/icons-react";
import { useState } from "react";
import type { TakItem } from "../cot.ts";
import { ItemRow } from "../items/ItemsDrawer.tsx";
import { useNow } from "../use-now.ts";
import {
  createPlan,
  deletePlan,
  exportPlan,
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
};

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

const PlanDetail = ({ plan, onBack, ...props }: Props & { plan: Plan; onBack: () => void }) => {
  const now = useNow(10_000);
  const [publishing, setPublishing] = useState(false);
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
          color="danger"
          leftSection={<IconTrash size={14} />}
          onClick={() => deletePlan(plan)}
        >
          Discard
        </Button>
      </Group>
      <Button
        size="xs"
        onClick={() => void publishAll()}
        loading={publishing}
        disabled={drafts.length === 0 || !!props.publishReason}
        title={props.publishReason}
      >
        Publish {drafts.length} to TAK
      </Button>
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
          accept=".zip,application/zip"
          onChange={(file) =>
            file &&
            importPlan(file).then(
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
                {plan.entries.length} items · edited{" "}
                {new Date(plan.updated).toLocaleString("fi-FI")}
              </Text>
            </UnstyledButton>
          ))
        )}
      </ScrollArea>
    </Stack>
  );
};
