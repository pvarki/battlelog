import {
  Box,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Placeholder } from "../../components/Placeholder.tsx";
import { formatAge } from "../../time.ts";
import { useNow } from "../../use-now.ts";
import type { Sender } from "../identity.ts";
import type { MissionFile } from "../missions/missions.ts";
import { useWrite } from "../missions/shared.tsx";
import {
  createTemplate,
  fetchActiveChecklists,
  fetchTemplates,
  startChecklist,
  templateName,
} from "./api.ts";
import { ChecklistDetail, NO_CALLSIGN } from "./ChecklistDetail.tsx";
import { type Checklist, progress } from "./excheck.ts";

const POLL_MS = 60_000;

const NewButton = ({
  label,
  writer,
  onClick,
}: {
  label: string;
  writer: Sender | undefined;
  onClick: () => void;
}) => (
  <Tooltip label={NO_CALLSIGN} disabled={!!writer} withArrow>
    <Button
      size="xs"
      variant="default"
      leftSection={<IconPlus size={14} />}
      disabled={!writer}
      onClick={onClick}
    >
      {label}
    </Button>
  </Tooltip>
);

const NewChecklist = ({
  writer,
  onStarted,
}: {
  writer: Sender | undefined;
  onStarted: (uid: string) => void;
}) => {
  const [opened, setOpened] = useState(false);
  const [templates, setTemplates] = useState<MissionFile[] | null>();
  const [templateUid, setTemplateUid] = useState<string | null>(null);
  const [name, setName] = useState("");
  const { busy, run } = useWrite();
  useEffect(() => {
    if (!opened) return;
    setTemplates(undefined);
    fetchTemplates().then(setTemplates, (err) => {
      console.warn("TAK checklist templates failed", err);
      setTemplates(null);
    });
  }, [opened]);
  const trimmed = name.trim();
  const start = async () => {
    if (!writer || !templateUid) return;
    let started: Checklist | undefined;
    const ok = await run("Checklist not started", async () => {
      started = await startChecklist(writer, templateUid, trimmed);
    });
    if (!ok || !started) return;
    setOpened(false);
    setName("");
    setTemplateUid(null);
    onStarted(started.uid);
  };
  return (
    <>
      <NewButton label="New checklist" writer={writer} onClick={() => setOpened(true)} />
      <Modal opened={opened} onClose={() => setOpened(false)} title="New checklist" centered>
        <Stack gap="sm">
          <Select
            label="Template"
            placeholder={templates === undefined ? "Loading…" : "Pick a template"}
            data={(templates ?? []).map((t) => ({ value: t.uid, label: templateName(t) }))}
            value={templateUid}
            onChange={(value) => {
              setTemplateUid(value);
              const picked = templates?.find((t) => t.uid === value);
              if (picked && !trimmed) setName(templateName(picked));
            }}
            error={
              templates === null
                ? "Couldn't load templates from TAK"
                : templates?.length === 0
                  ? "TAK has no templates yet: create one with New template"
                  : undefined
            }
            comboboxProps={{ withinPortal: true }}
            data-autofocus
          />
          <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              loading={busy}
              disabled={!templateUid || !trimmed}
              onClick={() => void start()}
            >
              Start
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};

const NewTemplate = ({ writer }: { writer: Sender | undefined }) => {
  const [opened, setOpened] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [taskText, setTaskText] = useState("");
  const { busy, run } = useWrite();
  const trimmed = name.trim();
  const tasks = taskText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const create = async () => {
    if (!writer) return;
    const template = { name: trimmed, description: description.trim(), tasks };
    if (await run("Template not created", () => createTemplate(writer, template))) {
      setOpened(false);
      setName("");
      setDescription("");
      setTaskText("");
    }
  };
  return (
    <>
      <NewButton label="New template" writer={writer} onClick={() => setOpened(true)} />
      <Modal opened={opened} onClose={() => setOpened(false)} title="New template" centered>
        <Stack gap="sm">
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            data-autofocus
          />
          <Textarea
            label="Description"
            autosize
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <Textarea
            label="Tasks"
            description="One per line"
            autosize
            minRows={5}
            value={taskText}
            onChange={(e) => setTaskText(e.currentTarget.value)}
          />
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              loading={busy}
              disabled={!trimmed || tasks.length === 0}
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

const ChecklistList = ({
  checklists,
  onOpen,
}: {
  checklists: Checklist[] | null | undefined;
  onOpen: (uid: string) => void;
}) => {
  const now = useNow(10_000);
  if (checklists === undefined) return <Loader size="xs" m="xs" />;
  if (checklists === null || checklists.length === 0)
    return (
      <Box py="md">
        {checklists === null ? (
          <Placeholder
            title="Couldn't load checklists from TAK"
            detail="The list is fetched again automatically."
          />
        ) : (
          <Placeholder
            title="No active checklists"
            detail="New checklist starts one from a template, for every TAK user to work through."
          />
        )}
      </Box>
    );
  return (
    <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars>
      {checklists.map((checklist) => {
        const { done, total } = progress(checklist);
        const started = checklist.startTime ? Date.parse(checklist.startTime) : Number.NaN;
        return (
          <UnstyledButton
            key={checklist.uid}
            className="tak-row"
            display="block"
            w="100%"
            onClick={() => onOpen(checklist.uid)}
          >
            <Text fz="sm" fw={600} truncate>
              {checklist.name}
            </Text>
            <Text fz="xs" c="dimmed" truncate>
              {done}/{total} complete
              {checklist.templateName ? ` · ${checklist.templateName}` : ""}
              {Number.isNaN(started) ? "" : ` · started ${formatAge(now - started)} ago`}
            </Text>
          </UnstyledButton>
        );
      })}
    </ScrollArea>
  );
};

/** ExCheck: TAK's shared checklists, started from templates and ticked off by anyone. */
export const ChecklistsDrawer = ({ writer }: { writer: Sender | undefined }) => {
  const [open, setOpen] = useState<string>();
  const [checklists, setChecklists] = useState<Checklist[] | null>();
  const writerUid = writer?.uid;
  useEffect(() => {
    if (open) return;
    let current = true;
    const load = () =>
      fetchActiveChecklists(writerUid).then(
        (loaded) => current && setChecklists(loaded),
        (err) => {
          console.warn("TAK checklists failed", err);
          if (current) setChecklists((known) => known ?? null);
        },
      );
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [open, writerUid]);
  if (open) return <ChecklistDetail uid={open} writer={writer} onBack={() => setOpen(undefined)} />;
  return (
    <Stack gap="xs" h="100%">
      <Group gap="xs" justify="flex-end">
        <NewTemplate writer={writer} />
        <NewChecklist writer={writer} onStarted={setOpen} />
      </Group>
      <ChecklistList checklists={checklists} onOpen={setOpen} />
    </Stack>
  );
};
