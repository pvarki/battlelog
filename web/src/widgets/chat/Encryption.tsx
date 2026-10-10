// Verification requests and verifiers mutate in place — see View.tsx.
"use no memo";

import {
  Alert,
  Button,
  Checkbox,
  Code,
  CopyButton,
  Divider,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconShieldExclamation } from "@tabler/icons-react";
import type { MatrixClient } from "matrix-js-sdk";
import {
  type GeneratedSecretStorageKey,
  type ShowSasCallbacks,
  VerificationPhase,
  type VerificationRequest,
  VerificationRequestEvent,
  VerifierEvent,
} from "matrix-js-sdk/lib/crypto-api/index.js";
import { useEffect, useReducer, useState } from "react";
import {
  createRecoveryKey,
  setUpEncryption,
  showVerification,
  unlockWithRecoveryKey,
  useActiveVerification,
  useDeviceTrust,
  useIsVerificationHost,
  verifyWithOtherSession,
} from "./encryption.ts";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const downloadText = (text: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
};

const SetUpModal = ({ client, onClose }: { client: MatrixClient; onClose: () => void }) => {
  const [key, setKey] = useState<GeneratedSecretStorageKey>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    createRecoveryKey(client).then(setKey, (err) => setError(errorText(err)));
  }, [client]);

  const finish = async () => {
    if (!key) return;
    setBusy(true);
    setError(undefined);
    try {
      await setUpEncryption(client, key);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const recoveryKey = key?.encodedPrivateKey ?? "";
  return (
    <Modal opened onClose={onClose} title="Set up encryption" size="md">
      <Stack gap="sm">
        <Text fz="sm">
          This is your first Matrix device. Save the recovery key below: you need it to read your
          messages on a new device or after clearing this browser.
        </Text>
        <Code block fz="md" style={{ wordBreak: "break-word", whiteSpace: "normal" }}>
          {recoveryKey || "Generating…"}
        </Code>
        <Group gap="xs">
          <CopyButton value={recoveryKey}>
            {({ copied, copy }) => (
              <Button size="xs" variant="default" disabled={!recoveryKey} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            )}
          </CopyButton>
          <Button
            size="xs"
            variant="default"
            disabled={!recoveryKey}
            onClick={() => downloadText(recoveryKey, "matrix-recovery-key.txt")}
          >
            Download
          </Button>
        </Group>
        <Checkbox
          label="I've saved my recovery key somewhere safe"
          checked={saved}
          onChange={(e) => setSaved(e.currentTarget.checked)}
        />
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Later
          </Button>
          <Button disabled={!saved || !key} loading={busy} onClick={() => void finish()}>
            Finish setup
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};

const VerifyModal = ({ client, onClose }: { client: MatrixClient; onClose: () => void }) => {
  const [recoveryKey, setRecoveryKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title="Unlock this device" size="md">
      <Stack gap="sm">
        <Text fz="sm">
          Unlock to read messages sent before this device signed in. Use another signed-in session
          (such as Element on your phone) or your recovery key.
        </Text>
        <Button
          variant="light"
          disabled={busy}
          onClick={() => void run(() => verifyWithOtherSession(client))}
        >
          Verify with another session (emoji)
        </Button>
        <Divider label="or" labelPosition="center" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => unlockWithRecoveryKey(client, recoveryKey));
          }}
        >
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput
              flex={1}
              label="Recovery key"
              placeholder="EsTc 1234 …"
              autoComplete="off"
              spellCheck={false}
              value={recoveryKey}
              onChange={(e) => setRecoveryKey(e.currentTarget.value)}
            />
            <Button type="submit" loading={busy} disabled={!recoveryKey.trim()}>
              Unlock
            </Button>
          </Group>
        </form>
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
      </Stack>
    </Modal>
  );
};

/** Whether this device can read history, and the dialog that fixes it when it can't. */
export const useUnlock = (client: MatrixClient) => {
  const trust = useDeviceTrust(client);
  const [open, setOpen] = useState(false);
  const locked = trust === "new" || trust === "unverified";
  return { trust, locked, open, setOpen };
};

export const EncryptionBanner = ({
  client,
  unlock,
  short,
}: {
  client: MatrixClient;
  unlock: ReturnType<typeof useUnlock>;
  /** Cramped widget: drop the sentence, keep the button. */
  short: boolean;
}) => {
  const { trust, locked, open, setOpen } = unlock;
  if (!locked) return null;

  const isNew = trust === "new";
  return (
    <>
      <Group
        gap="xs"
        px="sm"
        py={short ? 2 : 6}
        wrap="nowrap"
        bg="rgba(250, 176, 5, 0.1)"
        style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}
      >
        <IconShieldExclamation size={16} color="var(--mantine-color-yellow-5)" />
        <Text fz="xs" flex={1} miw={0} truncate>
          {!short &&
            (isNew
              ? "Set up a recovery key to keep your message history"
              : "Older messages are locked on this device")}
        </Text>
        <Button size="compact-xs" variant="light" color="yellow" onClick={() => setOpen(true)}>
          {isNew ? "Set up" : "Unlock"}
        </Button>
      </Group>
      {open && isNew && <SetUpModal client={client} onClose={() => setOpen(false)} />}
      {open && !isNew && <VerifyModal client={client} onClose={() => setOpen(false)} />}
    </>
  );
};

// The verifier must be driven exactly once, even if effects re-run.
const started = new WeakSet<object>();

const startSas = (request: VerificationRequest, onError: (message?: string) => void) => {
  started.add(request);
  onError(undefined);
  request.startVerification("m.sas.v1").catch((err) => {
    started.delete(request);
    onError(errorText(err));
  });
};

const useVerificationProgress = (request: VerificationRequest) => {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [sas, setSas] = useState<ShowSasCallbacks | null>(null);
  const [startError, setStartError] = useState<string>();

  useEffect(() => {
    request.on(VerificationRequestEvent.Change, rerender);
    return () => void request.off(VerificationRequestEvent.Change, rerender);
  }, [request]);

  useEffect(() => {
    if (request.phase === VerificationPhase.Ready && !started.has(request)) {
      startSas(request, setStartError);
    }
  }, [request, request.phase]);

  const verifier = request.verifier;
  useEffect(() => {
    if (!verifier) return;
    verifier.on(VerifierEvent.ShowSas, setSas);
    setSas(verifier.getShowSasCallbacks());
    if (!started.has(verifier)) {
      started.add(verifier);
      verifier.verify().catch(() => {});
    }
    return () => void verifier.off(VerifierEvent.ShowSas, setSas);
  }, [verifier]);

  return { sas, startError, retry: () => startSas(request, setStartError) };
};

const VerificationBody = ({ request }: { request: VerificationRequest }) => {
  const { sas, startError, retry } = useVerificationProgress(request);
  const [answered, setAnswered] = useState(false);
  const close = () => showVerification(undefined);

  switch (request.phase) {
    case VerificationPhase.Requested:
      if (request.initiatedByMe) {
        return <Text fz="sm">Accept the request on your other session (e.g. Element).</Text>;
      }
      return (
        <Stack gap="sm">
          <Text fz="sm">
            Another of your sessions{request.otherDeviceId && ` (${request.otherDeviceId})`} wants
            to verify this device.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => void request.cancel().finally(close)}>
              Decline
            </Button>
            <Button onClick={() => void request.accept()}>Accept</Button>
          </Group>
        </Stack>
      );
    case VerificationPhase.Done:
      return (
        <Stack gap="sm">
          <Text fz="sm">This device is verified.</Text>
          <Group justify="flex-end">
            <Button onClick={close}>Done</Button>
          </Group>
        </Stack>
      );
    case VerificationPhase.Cancelled:
      return (
        <Stack gap="sm">
          <Text fz="sm">Verification was cancelled. You can start again from the chat widget.</Text>
          <Group justify="flex-end">
            <Button onClick={close}>Close</Button>
          </Group>
        </Stack>
      );
  }

  if (startError) {
    return (
      <Stack gap="sm">
        <Alert color="red" variant="light">
          Couldn't start emoji verification: {startError}
        </Alert>
        <Group justify="flex-end">
          <Button onClick={retry}>Try again</Button>
        </Group>
      </Stack>
    );
  }
  if (!sas) return <Text fz="sm">Waiting for the other session…</Text>;
  if (answered) return <Text fz="sm">Waiting for the other session to confirm…</Text>;
  return (
    <Stack gap="sm">
      <Text fz="sm">Check that these emoji appear on the other session, in the same order.</Text>
      {sas.sas.emoji ? (
        <SimpleGrid cols={4} spacing="xs">
          {sas.sas.emoji.map(([emoji, name]) => (
            <Stack key={name} gap={0} align="center">
              <Text fz={32} lh={1.2}>
                {emoji}
              </Text>
              <Text fz="xs" c="dimmed">
                {name}
              </Text>
            </Stack>
          ))}
        </SimpleGrid>
      ) : (
        <Text fz="xl" ta="center" ff="monospace">
          {sas.sas.decimal?.join(" ")}
        </Text>
      )}
      <Group justify="flex-end">
        <Button variant="default" color="red" onClick={() => sas.mismatch()}>
          They don't match
        </Button>
        <Button
          onClick={() => {
            setAnswered(true);
            void sas.confirm();
          }}
        >
          They match
        </Button>
      </Group>
    </Stack>
  );
};

/** Rendered by every chat widget; only one of them actually shows the dialog. */
export const VerificationDialog = () => {
  const request = useActiveVerification();
  const isHost = useIsVerificationHost();
  if (!request || !isHost) return null;

  const finished =
    request.phase === VerificationPhase.Done || request.phase === VerificationPhase.Cancelled;
  return (
    <Modal
      opened
      title="Verify session"
      onClose={() => {
        if (!finished) void request.cancel();
        showVerification(undefined);
      }}
    >
      <VerificationBody key={request.transactionId} request={request} />
    </Modal>
  );
};
