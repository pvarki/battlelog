import { Group, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useState } from "react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { fetchGroups, setActiveGroups, type TakGroup, withActive } from "../groups.ts";
import { TakRequestError } from "../rest.ts";
import { refetchTakHistory } from "../session.ts";

// TAK's IN/OUT is from the server's side: IN carries what this user sends.
const DIRECTION_LABEL: Record<TakGroup["direction"], string> = { IN: "Send", OUT: "Receive" };
const DIRECTION_HINT: Record<TakGroup["direction"], string> = {
  IN: "What you send goes to this group",
  OUT: "You receive what this group shares",
};

const describe = (err: unknown) =>
  err instanceof TakRequestError && err.status === 403
    ? "TAK doesn't let your certificate manage groups (403)."
    : err instanceof Error
      ? err.message
      : String(err);

/** Which of the user's TAK groups this connection sends to and receives from. */
export const GroupsSection = ({ clientUid }: { clientUid: string | undefined }) => {
  const [groups, setGroups] = useState<TakGroup[]>();
  const [loadError, setLoadError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    fetchGroups(abort.signal).then(setGroups, (err) => {
      if (!abort.signal.aborted) setLoadError(describe(err));
    });
    return () => abort.abort();
  }, []);

  const toggle = async (target: TakGroup, active: boolean) => {
    if (!groups || !clientUid) return;
    setSaving(true);
    try {
      await setActiveGroups(withActive(groups, target, active), clientUid);
      setGroups(await fetchGroups());
      refetchTakHistory();
    } catch (err) {
      notifications.show({
        color: "danger",
        title: "Couldn't change TAK groups",
        message: describe(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap={6}>
      <SectionHeading>TAK groups</SectionHeading>
      {loadError ? (
        <Text fz="xs" c="danger.4">
          Couldn't load your TAK groups: {loadError}
        </Text>
      ) : !groups ? (
        <Text fz="xs" c="dimmed">
          Loading…
        </Text>
      ) : groups.length === 0 ? (
        <Text fz="xs" c="dimmed">
          Your certificate isn't in any TAK group.
        </Text>
      ) : (
        groups.map((group) => (
          <Group key={`${group.name} ${group.direction}`} gap="xs" wrap="nowrap">
            <Switch
              size="xs"
              style={{ flex: 1 }}
              label={group.name}
              description={group.description}
              checked={group.active}
              disabled={saving || !clientUid}
              onChange={(e) => void toggle(group, e.currentTarget.checked)}
            />
            <Text fz="xs" c="dimmed" title={DIRECTION_HINT[group.direction]}>
              {DIRECTION_LABEL[group.direction]}
            </Text>
          </Group>
        ))
      )}
      {!clientUid && (
        <Text fz="xs" c="dimmed">
          No callsign: open BattleLog from the deploy app to change groups.
        </Text>
      )}
    </Stack>
  );
};
