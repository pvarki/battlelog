import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconArrowLeft, IconPlayerStop } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Placeholder } from "../../components/Placeholder.tsx";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { formatShortDateTime } from "../../time.ts";
import type { Sender } from "../identity.ts";
import { useWrite } from "../missions/shared.tsx";
import { ensureSubscribed } from "../missions/writes.ts";
import { fetchChecklist, onChecklistChange, setTaskComplete, stopChecklist } from "./api.ts";
import {
  type Checklist,
  type ChecklistColumn,
  type ChecklistTask,
  isComplete,
  isLate,
  progress,
} from "./excheck.ts";

// A fallback: a subscribed checklist streams its changes.
const POLL_MS = 30_000;

export const NO_CALLSIGN = "No callsign: open BattleLog from the deploy app to change checklists";

const TaskRow = ({
  task,
  columns,
  writeReason,
  busy,
  onToggle,
}: {
  task: ChecklistTask;
  columns: ChecklistColumn[];
  writeReason: string | undefined;
  busy: boolean;
  onToggle: () => void;
}) => {
  if (task.lineBreak) return <SectionHeading>{task.lineBreakText ?? ""}</SectionHeading>;
  const [title, ...rest] = task.values;
  const others = rest.flatMap((value, i) =>
    value ? [`${columns[i + 1]?.name ?? "—"}: ${value}`] : [],
  );
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start" className="tak-row">
      <Tooltip label={writeReason} disabled={!writeReason} withArrow>
        <Checkbox
          mt={2}
          size="xs"
          aria-label={`${title ?? "Task"} done`}
          checked={isComplete(task)}
          disabled={!!writeReason || busy}
          onChange={onToggle}
        />
      </Tooltip>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Group gap={4} wrap="nowrap">
          <Text fz="sm" style={{ flex: 1, minWidth: 0 }}>
            {title}
          </Text>
          {isLate(task) && (
            <Badge size="xs" variant="outline" color="warning" style={{ flexShrink: 0 }}>
              {task.status}
            </Badge>
          )}
        </Group>
        {others.length > 0 && (
          <Text fz="xs" c="dimmed">
            {others.join(" · ")}
          </Text>
        )}
        {isComplete(task) && (task.completeBy || task.completeDTG) && (
          <Text fz="xs" c="dimmed">
            Done
            {task.completeBy ? ` by ${task.completeBy}` : ""}
            {task.completeDTG ? ` ${formatShortDateTime(task.completeDTG)}` : ""}
          </Text>
        )}
        {task.notes && (
          <Text fz="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
            {task.notes}
          </Text>
        )}
      </Box>
    </Group>
  );
};

const StopChecklist = ({ checklist, onStop }: { checklist: Checklist; onStop: () => void }) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        size="xs"
        variant="light"
        color="danger"
        leftSection={<IconPlayerStop size={14} />}
        onClick={() => setConfirming(true)}
      >
        Stop checklist
      </Button>
      <ConfirmDialog
        opened={confirming}
        onClose={() => setConfirming(false)}
        title={`Stop ${checklist.name}?`}
        confirmLabel="Stop"
        onConfirm={onStop}
      >
        The checklist leaves the active list for every TAK user.
      </ConfirmDialog>
    </>
  );
};

export const ChecklistDetail = ({
  uid,
  writer,
  onBack,
}: {
  uid: string;
  writer: Sender | undefined;
  onBack: () => void;
}) => {
  const [checklist, setChecklist] = useState<Checklist | null>();
  const { busy, run } = useWrite();
  useEffect(() => {
    let latest = 0;
    const load = () => {
      const request = ++latest;
      fetchChecklist(uid).then(
        (loaded) => request === latest && setChecklist(loaded),
        (err) => {
          console.warn(`TAK checklist ${uid} failed`, err);
          if (request === latest) setChecklist((current) => current ?? null);
        },
      );
    };
    load();
    const timer = setInterval(load, POLL_MS);
    const unlisten = onChecklistChange(
      (missions) => (missions.length === 0 || missions.includes(uid)) && load(),
    );
    return () => {
      latest = -1;
      clearInterval(timer);
      unlisten();
    };
  }, [uid]);
  const writerUid = writer?.uid;
  useEffect(() => {
    // Subscribed, TAK streams the checklist's changes as it does for ATAK.
    if (writerUid)
      ensureSubscribed(uid, writerUid).catch((err) =>
        console.warn(`Couldn't subscribe to TAK checklist ${uid}`, err),
      );
  }, [uid, writerUid]);
  const toggle = (task: ChecklistTask) => {
    if (!writer) return;
    void run("Task not updated", async () => {
      await setTaskComplete(writer, uid, task, !isComplete(task));
      setChecklist(await fetchChecklist(uid));
    });
  };
  const header = (
    <Group gap="xs" wrap="nowrap">
      <ActionIcon variant="subtle" color="gray" onClick={onBack} aria-label="Back to checklists">
        <IconArrowLeft size={16} />
      </ActionIcon>
      <Text fw={600} truncate>
        {checklist?.name ?? "Checklist"}
      </Text>
    </Group>
  );
  if (checklist === undefined)
    return (
      <Stack gap="xs">
        {header}
        <Loader size="xs" m="xs" />
      </Stack>
    );
  if (checklist === null)
    return (
      <Stack gap="xs" h="100%">
        {header}
        <Placeholder
          title="Couldn't load the checklist from TAK"
          detail="It may have been stopped; it's fetched again automatically."
        />
      </Stack>
    );
  const { done, total } = progress(checklist);
  return (
    <Stack gap="xs" h="100%">
      {header}
      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        <Stack gap="sm">
          {checklist.description && (
            <Text fz="sm" style={{ whiteSpace: "pre-wrap" }}>
              {checklist.description}
            </Text>
          )}
          <Text fz="xs" c="dimmed">
            {done}/{total} complete
            {checklist.templateName ? ` · from ${checklist.templateName}` : ""}
            {checklist.startTime ? ` · started ${formatShortDateTime(checklist.startTime)}` : ""}
            {checklist.creatorCallsign ? ` by ${checklist.creatorCallsign}` : ""}
          </Text>
          <Stack gap={4}>
            {checklist.tasks.map((task) => (
              <TaskRow
                key={task.uid}
                task={task}
                columns={checklist.columns}
                writeReason={writer ? undefined : NO_CALLSIGN}
                busy={busy}
                onToggle={() => toggle(task)}
              />
            ))}
          </Stack>
          {writer && checklist.creatorUid === writer.uid && (
            <Group>
              <StopChecklist
                checklist={checklist}
                onStop={() =>
                  writer &&
                  void run("Checklist not stopped", () => stopChecklist(writer, uid)).then(
                    (ok) => ok && onBack(),
                  )
                }
              />
            </Group>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
};
