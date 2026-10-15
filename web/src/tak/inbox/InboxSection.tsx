import { ActionIcon, Anchor, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronDown, IconChevronRight, IconTrash, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { formatClockTime, formatDateTime } from "../../time.ts";
import { useCallsign } from "../identity.ts";
import { notifyFailure } from "../notify.ts";
import { takBaseUrl, takPublicUrl } from "../rest.ts";
import { isOnTak, type PackageRef } from "./fileshare.ts";
import {
  deleteTakPackage,
  fetchTakPackages,
  importPackage,
  isOwnPackage,
  type TakPackage,
  useImported,
} from "./import.ts";
import { dismissShare, useInbox } from "./store.ts";

const formatSize = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} kB`;

type RowProps = {
  pkg: PackageRef;
  detail: string;
  /** Why it can't be imported, or undefined when it can. */
  unavailable?: string;
  onDismiss?: () => void;
  onDelete?: () => void;
  onOpenPlan: (id: string) => void;
};

const PackageRow = ({ pkg, detail, unavailable, onDismiss, onDelete, onOpenPlan }: RowProps) => {
  const [busy, setBusy] = useState(false);
  const result = useImported(pkg.hash);

  const runImport = async () => {
    setBusy(true);
    try {
      const { planId, attached, files } = await importPackage(pkg);
      const made = [
        planId && "a plan of its map items",
        attached && `${attached} attachment${attached > 1 ? "s" : ""} shown in item details`,
        files.length && `${files.length} file${files.length > 1 ? "s" : ""} to save`,
      ].filter(Boolean);
      notifications.show({
        color: made.length ? "teal" : "orange",
        title: `Imported ${pkg.name}`,
        message: made.length ? `Made ${made.join(", ")}.` : "The package held nothing to show.",
      });
      if (planId) onOpenPlan(planId);
    } catch (err) {
      notifications.show({ color: "danger", title: "Couldn't import", message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tak-row">
      <Group gap={6} wrap="nowrap">
        <Text fz="sm" fw={500} truncate style={{ flex: 1 }}>
          {pkg.name}
        </Text>
        {!result && (
          <Button
            size="compact-xs"
            variant="default"
            loading={busy}
            disabled={!!unavailable}
            title={unavailable}
            onClick={() => void runImport()}
          >
            Import
          </Button>
        )}
        {onDismiss && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={`Dismiss ${pkg.name}`}
            onClick={onDismiss}
          >
            <IconX size={16} />
          </ActionIcon>
        )}
        {onDelete && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={`Delete ${pkg.name} from TAK`}
            title="Delete from TAK"
            onClick={onDelete}
          >
            <IconTrash size={16} />
          </ActionIcon>
        )}
      </Group>
      <Text fz="xs" c="dimmed">
        {unavailable ?? detail}
      </Text>
      {result?.planId && (
        <Anchor component="button" fz="xs" onClick={() => onOpenPlan(result.planId as string)}>
          Open plan
        </Anchor>
      )}
      {result?.files.map((file) => (
        <Anchor key={file.url} href={file.url} download={file.name} fz="xs" display="block">
          Save {file.name}
        </Anchor>
      ))}
    </div>
  );
};

/** Data packages sent to us, and those anyone put on TAK Server, ready to import. */
export const InboxSection = ({
  onOpenPlan,
  clientUid,
}: {
  onOpenPlan: (id: string) => void;
  /** Who this browser writes to TAK as; undefined when it may not change TAK. */
  clientUid: string | undefined;
}) => {
  const shares = useInbox();
  const callsign = useCallsign();
  const [onTak, setOnTak] = useState<TakPackage[] | "loading" | "failed">();
  const [deleting, setDeleting] = useState<TakPackage>();
  const takUrls = [takBaseUrl(), takPublicUrl()];

  const deletePackage = (pkg: TakPackage) =>
    deleteTakPackage(pkg.hash).then(setOnTak, notifyFailure("Data package not deleted"));

  const toggleOnTak = () => {
    if (onTak) return setOnTak(undefined);
    setOnTak("loading");
    fetchTakPackages().then(setOnTak, (err: unknown) => {
      console.warn("TAK data packages unavailable", err);
      setOnTak("failed");
    });
  };

  return (
    <Stack gap={4}>
      {shares.length > 0 && (
        <Text fz="xs" fw={600} c="dimmed">
          Received data packages
        </Text>
      )}
      {shares.map((share) => (
        <PackageRow
          key={share.id}
          pkg={share}
          detail={`From ${share.senderCallsign || "unknown"} · ${formatSize(share.size)} · ${formatClockTime(share.time)}`}
          unavailable={
            isOnTak(share.senderUrl, takUrls)
              ? undefined
              : "Offered from the sender's device, not through TAK Server"
          }
          onDismiss={() => dismissShare(share.id)}
          onOpenPlan={onOpenPlan}
        />
      ))}
      <Button
        size="xs"
        variant="subtle"
        color="gray"
        justify="start"
        leftSection={onTak ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        onClick={toggleOnTak}
      >
        Data packages on TAK
      </Button>
      {onTak === "loading" && <Loader size="xs" mx="auto" />}
      {onTak === "failed" && (
        <Text fz="xs" c="danger.4">
          Couldn't list TAK's data packages.
        </Text>
      )}
      {Array.isArray(onTak) &&
        (onTak.length === 0 ? (
          <Text fz="xs" c="dimmed">
            No data packages on TAK.
          </Text>
        ) : (
          onTak.map((pkg) => (
            <PackageRow
              key={pkg.hash}
              pkg={pkg}
              detail={`${pkg.by || "Unknown"} · ${formatSize(pkg.size)} · ${formatDateTime(pkg.submitted)}`}
              onDelete={
                clientUid && isOwnPackage(pkg, callsign) ? () => setDeleting(pkg) : undefined
              }
              onOpenPlan={onOpenPlan}
            />
          ))
        ))}
      <ConfirmDialog
        opened={!!deleting}
        onClose={() => setDeleting(undefined)}
        title={`Delete ${deleting?.name}?`}
        confirmLabel="Delete"
        onConfirm={() => deleting && void deletePackage(deleting)}
      >
        The package is removed from TAK Server for every user. Copies already imported or saved
        stay.
      </ConfirmDialog>
    </Stack>
  );
};
