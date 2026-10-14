import { Box, Button, Group, Loader, Text, Textarea } from "@mantine/core";
import { useEffect, useState } from "react";
import { Placeholder } from "../../components/Placeholder.tsx";
import { formatDateTime } from "../../time.ts";
import type { MissionsDrawerProps } from "./MissionsDrawer.tsx";
import { fetchMissionLog, type MissionLogEntry } from "./missions.ts";

export const MissionLog = ({
  name,
  callsignOf,
}: {
  name: string;
  callsignOf: MissionsDrawerProps["callsignOf"];
}) => {
  const [entries, setEntries] = useState<MissionLogEntry[] | "failed">();
  useEffect(() => {
    const abort = new AbortController();
    setEntries(undefined);
    fetchMissionLog(name, abort.signal).then(setEntries, () => {
      if (!abort.signal.aborted) setEntries("failed");
    });
    return () => abort.abort();
  }, [name]);
  if (entries === undefined) return <Loader size="xs" m="xs" />;
  if (entries === "failed")
    return (
      <Box py="md">
        <Placeholder title="Couldn't load the log" detail="Open the feed again to retry." />
      </Box>
    );
  if (entries.length === 0)
    return (
      <Box py="md">
        <Placeholder title="No log entries" detail="Nobody has written to this feed's log yet." />
      </Box>
    );
  return entries.map((entry) => (
    <div key={entry.id} className="tak-row">
      <Text fz="xs" c="dimmed">
        {formatDateTime(entry.time)}
        {entry.creatorUid ? ` · ${callsignOf(entry.creatorUid) ?? entry.creatorUid}` : ""}
      </Text>
      <Text fz="sm" style={{ whiteSpace: "pre-wrap" }}>
        {entry.content}
      </Text>
    </div>
  ));
};

export const NewLogEntry = ({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (text: string) => Promise<boolean>;
}) => {
  const [text, setText] = useState("");
  const add = async () => {
    if (await onAdd(text.trim())) setText("");
  };
  return (
    <Group gap="xs" align="flex-end" wrap="nowrap" p="xs">
      <Textarea
        size="xs"
        style={{ flex: 1 }}
        placeholder="New log entry"
        aria-label="New log entry"
        autosize
        minRows={1}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
      />
      <Button
        size="xs"
        variant="default"
        disabled={disabled || !text.trim()}
        onClick={() => void add()}
      >
        Add
      </Button>
    </Group>
  );
};
