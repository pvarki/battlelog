import { Box, Button, Group, Loader, PasswordInput, Select, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { Placeholder } from "../../components/Placeholder.tsx";
import type { MissionsDrawerProps } from "./MissionsDrawer.tsx";
import {
  fetchInvitations,
  fetchMembers,
  INVITEE_TYPES,
  type InviteeType,
  type Mission,
  type MissionInvitation,
  type MissionMember,
  type MissionRole,
  ROLE_LABELS,
} from "./missions.ts";
import { RemoveButton, roleOptions, Section, useWrite } from "./shared.tsx";
import { invite, setPassword, setRole, uninvite } from "./writes.ts";

const INVITEE_LABELS: Record<InviteeType, string> = {
  callsign: "Callsign",
  clientUid: "Client uid",
  group: "Group",
};

const InviteForm = ({
  disabled,
  onInvite,
}: {
  disabled: boolean;
  onInvite: (type: InviteeType, invitee: string, role: MissionRole) => Promise<boolean>;
}) => {
  const [type, setType] = useState<InviteeType>("callsign");
  const [invitee, setInvitee] = useState("");
  const [role, chooseRole] = useState<MissionRole>("MISSION_SUBSCRIBER");
  const trimmed = invitee.trim();
  const send = async () => {
    if (await onInvite(type, trimmed, role)) setInvitee("");
  };
  return (
    <Group gap="xs" align="flex-end" p="xs">
      <Select
        size="xs"
        w={110}
        aria-label="Invite by"
        data={INVITEE_TYPES.map((t) => ({ value: t, label: INVITEE_LABELS[t] }))}
        value={type}
        onChange={(value) => value && setType(value as InviteeType)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      <TextInput
        size="xs"
        style={{ flex: 1, minWidth: 120 }}
        placeholder={INVITEE_LABELS[type]}
        aria-label="Invitee"
        value={invitee}
        onChange={(e) => setInvitee(e.currentTarget.value)}
      />
      <Select
        size="xs"
        w={110}
        aria-label="Role for the invitee"
        data={roleOptions}
        value={role}
        onChange={(value) => value && chooseRole(value as MissionRole)}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />
      <Button
        size="xs"
        variant="default"
        disabled={disabled || !trimmed}
        onClick={() => void send()}
      >
        Invite
      </Button>
    </Group>
  );
};

const PasswordControls = ({
  mission,
  disabled,
  onSet,
}: {
  mission: Mission;
  disabled: boolean;
  onSet: (password: string | undefined) => Promise<boolean>;
}) => {
  const [password, setPasswordText] = useState("");
  const save = async () => {
    if (await onSet(password)) setPasswordText("");
  };
  return (
    <Group gap="xs" align="flex-end" p="xs">
      <PasswordInput
        size="xs"
        style={{ flex: 1, minWidth: 120 }}
        placeholder={mission.passwordProtected ? "New password" : "Password"}
        aria-label="Feed password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPasswordText(e.currentTarget.value)}
      />
      <Button
        size="xs"
        variant="default"
        disabled={disabled || !password}
        onClick={() => void save()}
      >
        {mission.passwordProtected ? "Change password" : "Set password"}
      </Button>
      {mission.passwordProtected && (
        <Button
          size="xs"
          variant="default"
          disabled={disabled}
          onClick={() => void onSet(undefined)}
        >
          Remove password
        </Button>
      )}
    </Group>
  );
};

/** Subscribers and their roles; owners also manage roles, invitations and the password. */
export const MissionMembers = ({
  mission,
  clientUid,
  owner,
  callsignOf,
}: {
  mission: Mission;
  clientUid: string;
  owner: boolean;
  callsignOf: MissionsDrawerProps["callsignOf"];
}) => {
  const { busy, run } = useWrite();
  const [reloads, setReloads] = useState(0);
  const [members, setMembers] = useState<MissionMember[] | "failed">();
  const [invitations, setInvitations] = useState<MissionInvitation[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reloads` is how a change asks to load again.
  useEffect(() => {
    const abort = new AbortController();
    fetchMembers(mission.name, abort.signal).then(setMembers, () => {
      if (!abort.signal.aborted) setMembers("failed");
    });
    if (owner) {
      fetchInvitations(mission.name, abort.signal).then(setInvitations, () => setInvitations([]));
    }
    return () => abort.abort();
  }, [mission.name, owner, reloads]);
  const change = (failureTitle: string, write: () => Promise<unknown>) =>
    run(failureTitle, write).then((ok) => {
      if (ok) setReloads((n) => n + 1);
      return ok;
    });
  return (
    <Section title="Members">
      {mission.defaultRole && (
        <Text fz="xs" c="dimmed" px="xs">
          New subscribers join as {ROLE_LABELS[mission.defaultRole]}.
        </Text>
      )}
      {members === undefined && <Loader size="xs" m="xs" />}
      {members === "failed" && (
        <Box py="md">
          <Placeholder title="Couldn't load the members" detail="Open the feed again to retry." />
        </Box>
      )}
      {Array.isArray(members) &&
        members.map((member) => {
          const me = member.clientUid === clientUid;
          const name = callsignOf(member.clientUid) ?? member.username ?? member.clientUid;
          return (
            <Group key={member.clientUid} gap="xs" wrap="nowrap" className="tak-row">
              <Text fz="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                {me ? `${name} (you)` : name}
              </Text>
              {owner && !me ? (
                <Select
                  size="xs"
                  w={120}
                  aria-label={`Role of ${name}`}
                  data={roleOptions}
                  value={member.role ?? null}
                  allowDeselect={false}
                  disabled={busy}
                  onChange={(role) =>
                    role &&
                    void change(`Role of ${name} not changed`, () =>
                      setRole(mission.name, member.clientUid, role as MissionRole, clientUid),
                    )
                  }
                  comboboxProps={{ withinPortal: true }}
                />
              ) : (
                <Text fz="xs" c="dimmed">
                  {member.role ? ROLE_LABELS[member.role] : ""}
                </Text>
              )}
            </Group>
          );
        })}
      {owner && (
        <>
          {invitations.map((invitation) => (
            <Group
              key={`${invitation.type}:${invitation.invitee}`}
              gap="xs"
              wrap="nowrap"
              className="tak-row"
            >
              <Text fz="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                Invited: {INVITEE_LABELS[invitation.type].toLowerCase()} {invitation.invitee}
              </Text>
              <Text fz="xs" c="dimmed">
                {invitation.role ? ROLE_LABELS[invitation.role] : ""}
              </Text>
              <RemoveButton
                label={`Withdraw the invitation of ${invitation.invitee}`}
                disabled={busy}
                onClick={() =>
                  void change("Invitation not withdrawn", () =>
                    uninvite(mission.name, invitation.type, invitation.invitee, clientUid),
                  )
                }
              />
            </Group>
          ))}
          <InviteForm
            disabled={busy}
            onInvite={(type, invitee, role) =>
              change(`${invitee} not invited`, () =>
                invite(mission.name, type, invitee, role, clientUid),
              )
            }
          />
          <PasswordControls
            mission={mission}
            disabled={busy}
            onSet={(password) =>
              change(password ? "Password not set" : "Password not removed", () =>
                setPassword(mission.name, password, clientUid),
              )
            }
          />
        </>
      )}
    </Section>
  );
};
