import { ActionIcon, Anchor, Button, Group, Loader, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconChevronDown, IconChevronRight, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { takBaseUrl, takPublicUrl } from "../rest.ts";
import { isOnTak, type PackageRef } from "./fileshare.ts";
import { fetchTakPackages, importPackage, type TakPackage, useImported } from "./import.ts";
import { dismissShare, useInbox } from "./store.ts";

const formatSize = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} kB`;

type RowProps = {
  pkg: PackageRef;
  detail: string;
  /** Why it can't be imported, or undefined when it can. */
  unavailable?: string;
  onDismiss?: () => void;
  onOpenPlan: (id: string) => void;
};

const PackageRow = ({ pkg, detail, unavailable, onDismiss, onOpenPlan }: RowProps) => {
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
      notifications.show({ color: "red", title: "Couldn't import", message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tak-row">
      <Group gap={6} wrap="nowrap">
        <Text fz="sm" fw={600} truncate style={{ flex: 1 }}>
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
            <IconX size={14} />
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
export const InboxSection = ({ onOpenPlan }: { onOpenPlan: (id: string) => void }) => {
  const shares = useInbox();
  const [onTak, setOnTak] = useState<TakPackage[] | "loading" | "failed">();
  const takUrls = [takBaseUrl(), takPublicUrl()];

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
          detail={`From ${share.senderCallsign || "unknown"} · ${formatSize(share.size)} · ${new Date(share.time).toLocaleTimeString("fi-FI")}`}
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
              detail={`${pkg.by || "Unknown"} · ${formatSize(pkg.size)} · ${new Date(pkg.submitted).toLocaleString("fi-FI")}`}
              onOpenPlan={onOpenPlan}
            />
          ))
        ))}
    </Stack>
  );
};
