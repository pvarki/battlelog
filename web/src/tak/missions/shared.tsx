import { ActionIcon } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { type ReactNode, useState } from "react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { notifyFailure } from "../notify.ts";
import { MISSION_ROLES, ROLE_LABELS } from "./missions.ts";

/** Runs one write at a time, telling the user when it fails. */
export const useWrite = () => {
  const [busy, setBusy] = useState(false);
  /** Resolves true once the write is done, false when it failed. */
  const run = async (failureTitle: string, write: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await write();
      return true;
    } catch (err) {
      notifyFailure(failureTitle)(err);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
};

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label={title}>
    <SectionHeading>{title}</SectionHeading>
    {children}
  </section>
);

export const RemoveButton = ({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) => (
  <ActionIcon
    variant="subtle"
    color="gray"
    size="sm"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
  >
    <IconX size={14} />
  </ActionIcon>
);

export const roleOptions = MISSION_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
