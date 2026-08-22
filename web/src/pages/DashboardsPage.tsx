import {
  ActionIcon,
  Anchor,
  Button,
  Container,
  FileButton,
  Group,
  Menu,
  Modal,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getRouteApi, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, useTransition } from "react";
import type { DashboardResponse } from "../api.ts";
import { dashboardsApi } from "../api.ts";
import { exportFilename, parseDashboardImport, toExportJson } from "../dashboard/transfer.ts";
import { formatDateTime } from "../time.ts";

const route = getRouteApi("/");

export const DashboardsPage = () => {
  const all = route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, startCreate] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const dashboards = all.filter((d) => !d.isTemplate);
  const templates = all.filter((d) => d.isTemplate);

  const createAndOpen = (json: { name: string; widgets: DashboardResponse["widgets"] }) =>
    startCreate(async () => {
      const res = await dashboardsApi.dashboards.$post({ json });
      if (!res.ok) throw new Error(`Failed to create dashboard (${res.status})`);
      const created = await res.json();
      await navigate({
        to: "/d/$dashboardId",
        params: { dashboardId: created.id },
      });
    });

  const create = () => {
    const trimmed = name.trim();
    if (trimmed) createAndOpen({ name: trimmed, widgets: [] });
  };

  // All list mutations funnel through here: surface failures (a silent no-op
  // delete reads as "the app is broken") and block double-clicks while one
  // is in flight.
  const mutate = async (label: string, fn: () => Promise<{ ok: boolean }>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(label);
      await router.invalidate();
    } catch {
      setError(`${label} failed — try again`);
    } finally {
      setBusy(false);
    }
  };

  const remove = (d: DashboardResponse) => {
    const kind = d.isTemplate ? "template" : "dashboard";
    if (!window.confirm(`Delete ${kind} "${d.name}"? This cannot be undone.`)) return;
    void mutate("Delete", () =>
      dashboardsApi.dashboards[":dashboardId"].$delete({ param: { dashboardId: d.id } }),
    );
  };

  const duplicate = (source: DashboardResponse) =>
    mutate("Duplicate", () =>
      dashboardsApi.dashboards.$post({
        json: { name: `${source.name} (copy)`, widgets: source.widgets },
      }),
    );

  const saveAsTemplate = (source: DashboardResponse) =>
    mutate("Save as template", () =>
      dashboardsApi.dashboards.$post({
        json: { name: source.name, isTemplate: true, widgets: source.widgets },
      }),
    );

  const download = (d: DashboardResponse) => {
    const url = URL.createObjectURL(new Blob([toExportJson(d)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFilename(d.name);
    a.click();
    // Revoking in the same tick can cancel the download before it starts.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // navigator.clipboard rejects outside a secure context — say so rather than
  // letting the menu item look like it did nothing.
  const copy = (d: DashboardResponse) =>
    navigator.clipboard.writeText(toExportJson(d)).then(
      () => notifications.show({ color: "teal", message: `Copied “${d.name}” JSON to clipboard` }),
      () =>
        notifications.show({
          color: "red",
          message: "Clipboard unavailable — use Download JSON instead",
        }),
    );

  // Own error state (not `mutate`'s): a rejected file is expected input here,
  // and the message belongs next to the textarea the user can fix.
  const runImport = () => {
    const parsed = parseDashboardImport(importText);
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    setImportError(null);
    startCreate(async () => {
      const res = await dashboardsApi.dashboards.$post({ json: parsed.value });
      if (!res.ok) {
        setImportError(`Rejected by the server (${res.status}) — not a valid dashboard export`);
        return;
      }
      const created = await res.json();
      setImportOpen(false);
      setImportText("");
      await navigate({ to: "/d/$dashboardId", params: { dashboardId: created.id } });
    });
  };

  const rowMenu = (d: DashboardResponse) => (
    <Menu position="bottom-end" shadow="md">
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={`Actions for ${d.name}`}
          title="Actions"
        >
          ⋯
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {!d.isTemplate && (
          <>
            <Menu.Item leftSection="☆" disabled={busy} onClick={() => saveAsTemplate(d)}>
              Save as template
            </Menu.Item>
            <Menu.Item leftSection="⧉" disabled={busy} onClick={() => duplicate(d)}>
              Duplicate
            </Menu.Item>
          </>
        )}
        <Menu.Item leftSection="⤓" onClick={() => download(d)}>
          Download JSON
        </Menu.Item>
        <Menu.Item leftSection="⎘" onClick={() => copy(d)}>
          Copy JSON
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection="✕" disabled={busy} onClick={() => remove(d)}>
          Delete{d.isTemplate ? " template" : ""}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  return (
    <Container size="xl" py="md">
      <Group justify="space-between" mb="md">
        <Title order={2}>Dashboards</Title>
        <Group>
          <TextInput
            placeholder="New dashboard name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            w={260}
          />
          <Button onClick={create} loading={creating} disabled={!name.trim()}>
            Create
          </Button>
          <Button variant="light" onClick={() => setImportOpen(true)}>
            Import
          </Button>
        </Group>
      </Group>

      {error && (
        <Text c="red.4" fz="sm" mb="sm" role="status">
          {error}
        </Text>
      )}

      <Modal
        opened={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import dashboard"
        size="lg"
      >
        <Stack>
          <Text c="dimmed" fz="sm">
            Layout and widget settings are restored. Note, todo, table and status widgets arrive
            empty — their contents live in this system's event log, not in the file.
          </Text>
          <Group>
            <FileButton
              accept="application/json,.json"
              onChange={async (file) => {
                if (!file) return;
                setImportError(null);
                setImportText(await file.text());
              }}
            >
              {(props) => (
                <Button variant="light" {...props}>
                  Choose file…
                </Button>
              )}
            </FileButton>
          </Group>
          <Textarea
            label="or paste exported JSON"
            autosize
            minRows={6}
            maxRows={16}
            value={importText}
            onChange={(e) => setImportText(e.currentTarget.value)}
          />
          {importError && (
            <Text c="red.4" fz="sm" role="status">
              {importError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button onClick={runImport} loading={creating} disabled={!importText.trim()}>
              Import
            </Button>
          </Group>
        </Stack>
      </Modal>

      {dashboards.length === 0 ? (
        <Text c="dimmed">No dashboards yet — create one above or start from a template.</Text>
      ) : (
        <Stack gap="xs">
          {dashboards.map((d) => (
            <Paper key={d.id} withBorder p="sm">
              <Group justify="space-between">
                <RowInfo dashboard={d} />
                {rowMenu(d)}
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {templates.length > 0 && (
        <>
          <Title order={3} mt="xl" mb="sm">
            Templates
          </Title>
          <Stack gap="xs">
            {templates.map((t) => (
              <Paper key={t.id} withBorder p="sm">
                <Group justify="space-between">
                  <RowInfo dashboard={t} />
                  <Group gap={4}>
                    <Button
                      size="compact-sm"
                      variant="light"
                      onClick={() => createAndOpen({ name: t.name, widgets: t.widgets })}
                    >
                      Use template
                    </Button>
                    {rowMenu(t)}
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        </>
      )}
    </Container>
  );
};

const RowInfo = ({ dashboard }: { dashboard: DashboardResponse }) => (
  <div>
    <Anchor
      renderRoot={(props) => (
        <Link to="/d/$dashboardId" params={{ dashboardId: dashboard.id }} {...props} />
      )}
    >
      {dashboard.name}
    </Anchor>
    <Text c="dimmed" fz="xs">
      {dashboard.widgets.length} widget
      {dashboard.widgets.length === 1 ? "" : "s"} · updated {formatDateTime(dashboard.updatedAt)}
    </Text>
  </div>
);
