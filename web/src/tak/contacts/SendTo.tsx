import { Button, Group, Modal, MultiSelect, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconSend } from "@tabler/icons-react";
import { useState } from "react";
import type { TakItem } from "../cot.ts";

export type RecipientGroup = { group: string; items: string[] };

/** TAK users' callsigns grouped by team, as Contacts lists them; each callsign once. */
export const recipientGroups = (users: Pick<TakItem, "callsign" | "team">[]): RecipientGroup[] => {
  const byTeam = new Map<string, Set<string>>();
  const seen = new Set<string>();
  for (const { callsign, team } of users) {
    if (!callsign || seen.has(callsign)) continue;
    seen.add(callsign);
    const key = team ?? "";
    byTeam.set(key, (byTeam.get(key) ?? new Set()).add(callsign));
  }
  return [...byTeam.keys()]
    .sort()
    .map((team) => ({ group: team || "No team", items: [...(byTeam.get(team) ?? [])].sort() }));
};

export const RecipientPicker = ({
  contacts,
  value,
  onChange,
}: {
  contacts: RecipientGroup[];
  value: string[];
  onChange: (callsigns: string[]) => void;
}) => (
  <MultiSelect
    size="xs"
    placeholder="Callsigns"
    aria-label="Send to"
    data={contacts}
    value={value}
    onChange={onChange}
    searchable
    comboboxProps={{ withinPortal: true }}
  />
);

type Props = {
  /** What is being sent, for the dialog title and notifications. */
  what: string;
  contacts: RecipientGroup[];
  /** Shown under the picker, e.g. how the delivery relates to plan mode. */
  note?: string;
  /** Why sending is unavailable, or undefined when it is. */
  disabledReason: string | undefined;
  onSend: (callsigns: string[]) => void | Promise<void>;
};

/** ATAK's "Send": a button opening a picker of TAK users; only they receive it. */
export const SendTo = ({ what, contacts, note, disabledReason, onSend }: Props) => {
  const [opened, setOpened] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      await onSend(chosen);
      notifications.show({ color: "success", message: `${what} sent to ${chosen.join(", ")}` });
      setOpened(false);
      setChosen([]);
    } catch (err) {
      notifications.show({ color: "danger", title: `${what} not sent`, message: String(err) });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Tooltip label={disabledReason} disabled={!disabledReason} withArrow>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconSend size={14} />}
          onClick={() => setOpened(true)}
          disabled={!!disabledReason}
        >
          Send to…
        </Button>
      </Tooltip>
      <Modal opened={opened} onClose={() => setOpened(false)} title={`Send ${what}`} centered>
        <Stack gap="sm">
          <RecipientPicker contacts={contacts} value={chosen} onChange={setChosen} />
          <Text fz="xs" c="dimmed">
            Only the chosen TAK users receive it.{note ? ` ${note}` : ""}
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button size="xs" variant="default" onClick={() => setOpened(false)}>
              Cancel
            </Button>
            <Button
              size="xs"
              onClick={() => void send()}
              loading={sending}
              disabled={chosen.length === 0}
            >
              Send
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
};
