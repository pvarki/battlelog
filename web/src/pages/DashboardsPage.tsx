import {
  ActionIcon,
  Anchor,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { getRouteApi, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { DashboardResponse } from "../api.ts";
import { dashboardsApi } from "../api.ts";

const route = getRouteApi("/");

export const DashboardsPage = () => {
  const all = route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const dashboards = all.filter((d) => !d.isTemplate);
  const templates = all.filter((d) => d.isTemplate);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await dashboardsApi.dashboards.$post({ json: { name: trimmed, widgets: [] } });
      if (!res.ok) throw new Error(`Failed to create dashboard (${res.status})`);
      const created = await res.json();
      navigate({ to: "/d/$dashboardId", params: { dashboardId: created.id } });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (dashboardId: string) => {
    await dashboardsApi.dashboards[":dashboardId"].$delete({ param: { dashboardId } });
    router.invalidate();
  };

  const duplicate = async (source: DashboardResponse) => {
    await dashboardsApi.dashboards.$post({
      json: { name: `${source.name} (copy)`, widgets: source.widgets },
    });
    router.invalidate();
  };

  // Template widgets with a configured eventId keep following the same live
  // event chains in the new dashboard; ones without fork fresh state.
  const useTemplate = async (template: DashboardResponse) => {
    const res = await dashboardsApi.dashboards.$post({
      json: { name: template.name, widgets: template.widgets },
    });
    if (!res.ok) return;
    const created = await res.json();
    navigate({ to: "/d/$dashboardId", params: { dashboardId: created.id } });
  };

  const saveAsTemplate = async (source: DashboardResponse) => {
    await dashboardsApi.dashboards.$post({
      json: { name: source.name, isTemplate: true, widgets: source.widgets },
    });
    router.invalidate();
  };

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
          <Button onClick={create} loading={busy} disabled={!name.trim()}>
            Create
          </Button>
        </Group>
      </Group>

      {dashboards.length === 0 ? (
        <Text c="dimmed">No dashboards yet — create one above or start from a template.</Text>
      ) : (
        <Stack gap="xs">
          {dashboards.map((d) => (
            <Paper key={d.id} withBorder p="sm">
              <Group justify="space-between">
                <RowInfo dashboard={d} />
                <Group gap={4}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Save ${d.name} as template`}
                    title="Save as template"
                    onClick={() => saveAsTemplate(d)}
                  >
                    ☆
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Duplicate ${d.name}`}
                    title="Duplicate"
                    onClick={() => duplicate(d)}
                  >
                    ⧉
                  </ActionIcon>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Delete ${d.name}`}
                    title="Delete"
                    onClick={() => remove(d.id)}
                  >
                    ✕
                  </ActionIcon>
                </Group>
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
                    <Button size="compact-sm" variant="light" onClick={() => useTemplate(t)}>
                      Use template
                    </Button>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Delete template ${t.name}`}
                      title="Delete template"
                      onClick={() => remove(t.id)}
                    >
                      ✕
                    </ActionIcon>
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
      {dashboard.widgets.length} widget{dashboard.widgets.length === 1 ? "" : "s"} · updated{" "}
      {new Date(dashboard.updatedAt).toLocaleString()}
    </Text>
  </div>
);
