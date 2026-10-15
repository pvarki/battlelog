import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  FileButton,
  Group,
  Loader,
  PasswordInput,
  ScrollArea,
  Stack,
  Switch,
  TagsInput,
  Text,
} from "@mantine/core";
import { IconArrowLeft, IconDownload, IconTrash, IconUpload } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Placeholder } from "../../components/Placeholder.tsx";
import { formatAge, formatDate } from "../../time.ts";
import { useNow } from "../../use-now.ts";
import { download } from "../download.ts";
import { ItemRow } from "../items/ItemsDrawer.tsx";
import { labelOf } from "../items.ts";
import { CopyMission } from "./CopyMission.tsx";
import { MissionFamily } from "./MissionFamily.tsx";
import { MissionLayers } from "./MissionLayers.tsx";
import { MissionLog, NewLogEntry } from "./MissionLog.tsx";
import { MissionMembers } from "./MissionMembers.tsx";
import type { MissionsDrawerProps } from "./MissionsDrawer.tsx";
import {
  fetchMissionExport,
  fileUrl,
  type Mission,
  type MissionExport,
  ROLE_LABELS,
} from "./missions.ts";
import { RemoveButton, Section, useWrite } from "./shared.tsx";
import {
  addFile,
  addLogEntry,
  canDelete,
  canWriteAs,
  deleteMission,
  loadSubscription,
  removeFile,
  removeItem,
  setKeywords,
  subscribe,
  unsubscribe,
  useSubscriptions,
} from "./writes.ts";

const formatSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1_048_576
      ? `${Math.round(bytes / 1024)} kB`
      : `${(bytes / 1_048_576).toFixed(1)} MB`;

const DeleteMission = ({
  mission,
  disabled,
  onDelete,
}: {
  mission: Mission;
  disabled: boolean;
  onDelete: () => void;
}) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        size="xs"
        variant="light"
        color="danger"
        leftSection={<IconTrash size={14} />}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        Delete feed
      </Button>
      <ConfirmDialog
        opened={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${mission.name}?`}
        confirmLabel="Delete"
        onConfirm={onDelete}
      >
        The feed is removed from TAK for every user, with its list of items, files and log. The map
        items themselves stay.
      </ConfirmDialog>
    </>
  );
};

export const MissionDetail = ({
  mission,
  ...props
}: MissionsDrawerProps & { mission: Mission }) => {
  const now = useNow(10_000);
  const { busy, run } = useWrite();
  const [logKey, setLogKey] = useState(0);
  const [password, setPasswordText] = useState("");
  const [keywordDraft, setKeywordDraft] = useState<string[]>();
  const { clientUid } = props;
  const subscription = useSubscriptions().get(mission.name);
  const subscribed = !!subscription;
  const role = subscription?.role;
  const owner = role === "MISSION_OWNER";
  const writable = !!clientUid && subscribed && canWriteAs(role);
  const canWrite = writable && !busy;
  useEffect(() => {
    if (clientUid)
      void loadSubscription(mission.name, clientUid, { fresh: true }).catch(() => undefined);
  }, [mission.name, clientUid]);
  const contents = props.state.contents.get(mission.name);
  const creator =
    mission.creatorUid && (props.callsignOf(mission.creatorUid) ?? mission.creatorUid);
  const exportAs = (kind: MissionExport, fileName: string) =>
    void run("Couldn't export the feed", async () =>
      download(await fetchMissionExport(mission.name, kind), fileName),
    );
  return (
    <Stack gap="xs" h="100%">
      <Group gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          color="gray"
          onClick={() => props.onOpen(undefined)}
          aria-label="Back to feeds"
        >
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Text fw={600} truncate>
          {mission.name}
        </Text>
      </Group>
      <ScrollArea style={{ flex: 1 }} offsetScrollbars="present">
        <Stack gap="sm">
          {mission.description && (
            <Text fz="sm" style={{ whiteSpace: "pre-wrap" }}>
              {mission.description}
            </Text>
          )}
          <Text fz="xs" c="dimmed">
            Created {formatDate(mission.createTime)}
            {creator ? ` by ${creator}` : ""}
            {mission.inviteOnly ? " · invite-only" : ""}
            {mission.passwordProtected ? " · password-protected" : ""}
          </Text>
          {writable ? (
            <TagsInput
              size="xs"
              aria-label="Keywords"
              placeholder="Add keyword"
              value={keywordDraft ?? mission.keywords}
              disabled={busy}
              onChange={(keywords) => {
                setKeywordDraft(keywords);
                void run("Keywords not saved", () =>
                  setKeywords(mission.name, keywords, clientUid),
                ).then(() => setKeywordDraft(undefined));
              }}
            />
          ) : (
            mission.keywords.length > 0 && (
              <Group gap={4}>
                {mission.keywords.map((k) => (
                  <Badge key={k} size="xs" variant="outline" color="gray">
                    {k}
                  </Badge>
                ))}
              </Group>
            )
          )}
          <MissionFamily
            mission={mission}
            missions={props.state.missions ?? []}
            onOpen={props.onOpen}
            clientUid={clientUid}
            owner={owner}
          />
          <Switch
            size="xs"
            label="Show on the map"
            checked={props.shown.has(mission.name)}
            onChange={() => props.onToggleShown(mission.name)}
          />
          {clientUid ? (
            <Group gap="xs" align="flex-end">
              {mission.passwordProtected && !subscribed && (
                <PasswordInput
                  size="xs"
                  style={{ flex: 1, minWidth: 120 }}
                  placeholder="Feed password"
                  aria-label="Feed password"
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPasswordText(e.currentTarget.value)}
                />
              )}
              <Button
                size="xs"
                variant={subscribed ? "default" : "filled"}
                disabled={busy}
                onClick={() =>
                  void (subscribed
                    ? run("Couldn't unsubscribe", () => unsubscribe(mission.name, clientUid))
                    : run("Couldn't subscribe", () =>
                        subscribe(mission.name, clientUid, password || undefined, mission),
                      ).then((ok) => ok && setPasswordText("")))
                }
              >
                {subscribed ? "Unsubscribe" : "Subscribe"}
              </Button>
              {role && (
                <Text fz="xs" c="dimmed">
                  Your role: {ROLE_LABELS[role]}
                </Text>
              )}
              {canDelete(mission, clientUid, role) && (
                <DeleteMission
                  mission={mission}
                  disabled={busy}
                  onDelete={() =>
                    void run("Feed not deleted", () => deleteMission(mission, clientUid)).then(
                      (ok) => ok && props.onOpen(undefined),
                    )
                  }
                />
              )}
            </Group>
          ) : (
            <Text fz="xs" c="dimmed">
              No callsign: open BattleLog from the deploy app to change feeds.
            </Text>
          )}
          <Group gap="xs">
            <Button
              size="xs"
              variant="default"
              leftSection={<IconDownload size={14} />}
              disabled={busy}
              onClick={() => exportAs("kml", `${mission.name}.kml`)}
            >
              Download KML
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconDownload size={14} />}
              disabled={busy}
              onClick={() => exportAs("archive", `${mission.name}.zip`)}
            >
              Download archive
            </Button>
            {clientUid && (
              <CopyMission
                mission={mission}
                clientUid={clientUid}
                disabled={busy}
                onCopied={props.onOpen}
              />
            )}
          </Group>
          {clientUid && !subscribed && (
            <Text fz="xs" c="dimmed">
              Subscribe to add items, files and log entries: TAK ignores changes from users who
              aren't subscribed.
            </Text>
          )}
          {subscribed && !writable && (
            <Text fz="xs" c="dimmed">
              You're a read-only subscriber: an owner can let you change the feed.
            </Text>
          )}
          <Section
            title={`Items ${contents?.kind === "loaded" ? contents.items.length : mission.itemUids.length}`}
          >
            {contents?.kind === "no-access" && (
              <Box py="md">
                <Placeholder
                  title="TAK didn't let you read this feed"
                  detail={
                    mission.passwordProtected || mission.inviteOnly
                      ? "Password or invitation needed."
                      : "Your TAK user has no access to it."
                  }
                />
              </Box>
            )}
            {contents?.kind === "failed" && (
              <Box py="md">
                <Placeholder
                  title="Couldn't load the items"
                  detail="They are fetched again automatically."
                />
              </Box>
            )}
            {(contents === undefined || contents.kind === "loading") && <Loader size="xs" m="xs" />}
            {contents?.kind === "loaded" && contents.items.length < mission.itemUids.length && (
              <Text fz="xs" c="dimmed" px="xs">
                {mission.itemUids.length - contents.items.length} more entries aren't map items
                (e.g. chat messages).
              </Text>
            )}
            {contents?.kind === "loaded" &&
              contents.items.map((item) => (
                <Group key={item.uid} gap={4} wrap="nowrap">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ItemRow
                      item={item}
                      now={now}
                      selected={item.uid === props.selectedUid}
                      onPick={() => props.onPick(item)}
                    />
                  </div>
                  {writable && (
                    <RemoveButton
                      label={`Remove ${labelOf(item)} from the feed`}
                      disabled={!canWrite}
                      onClick={() =>
                        void run("Item not removed", () =>
                          removeItem(mission.name, item.uid, clientUid),
                        )
                      }
                    />
                  )}
                </Group>
              ))}
            {contents?.kind === "loaded" && contents.items.length === 0 && writable && (
              <Text fz="xs" c="dimmed" p="xs">
                Add items from their details on the map.
              </Text>
            )}
          </Section>
          <Section title={`Files ${mission.files.length}`}>
            {mission.files.map((file) => (
              <Group key={file.uid} gap={4} wrap="nowrap" className="tak-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Anchor
                    fz="sm"
                    href={fileUrl(file)}
                    download={file.name}
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {file.name}
                  </Anchor>
                  <Text fz="xs" c="dimmed">
                    {formatSize(file.size)} · {formatAge(now - file.time)} ago
                    {file.submitter ? ` · ${file.submitter}` : ""}
                  </Text>
                </div>
                {writable && (
                  <RemoveButton
                    label={`Remove ${file.name} from the feed`}
                    disabled={!canWrite}
                    onClick={() =>
                      void run("File not removed", () =>
                        removeFile(mission.name, file.hash, clientUid),
                      )
                    }
                  />
                )}
              </Group>
            ))}
            {writable && (
              <FileButton
                onChange={(file) =>
                  file && void run("File not added", () => addFile(mission.name, file, clientUid))
                }
              >
                {(fileProps) => (
                  <Button
                    {...fileProps}
                    size="xs"
                    variant="default"
                    leftSection={<IconUpload size={14} />}
                    disabled={!canWrite}
                  >
                    Upload file
                  </Button>
                )}
              </FileButton>
            )}
          </Section>
          <MissionLayers mission={mission} />
          <Section title="Log">
            {writable && (
              <NewLogEntry
                disabled={!canWrite}
                onAdd={async (text) => {
                  const ok = await run("Log entry not added", () =>
                    addLogEntry(mission.name, text, clientUid),
                  );
                  if (ok) setLogKey((k) => k + 1);
                  return ok;
                }}
              />
            )}
            <MissionLog key={logKey} name={mission.name} callsignOf={props.callsignOf} />
          </Section>
          {clientUid && (
            <MissionMembers
              key={mission.name}
              mission={mission}
              clientUid={clientUid}
              owner={owner}
              callsignOf={props.callsignOf}
            />
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
};
