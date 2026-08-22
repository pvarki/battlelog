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
import { dashboardsApi } from "../api.ts";

const route = getRouteApi("/");

export const DashboardsPage = () => {
  const dashboards = route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

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

  const duplicate = async (id: string) => {
    const source = dashboards.find((d) => d.id === id);
    if (!source) return;
    await dashboardsApi.dashboards.$post({
      json: { name: `${source.name} (copy)`, widgets: source.widgets },
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
        <Text c="dimmed">No dashboards yet — create one above.</Text>
      ) : (
        <Stack gap="xs">
          {dashboards.map((d) => (
            <Paper key={d.id} withBorder p="sm">
              <Group justify="space-between">
                <div>
                  <Anchor
                    renderRoot={(props) => (
                      <Link to="/d/$dashboardId" params={{ dashboardId: d.id }} {...props} />
                    )}
                  >
                    {d.name}
                  </Anchor>
                  <Text c="dimmed" fz="xs">
                    {d.widgets.length} widget{d.widgets.length === 1 ? "" : "s"} · updated{" "}
                    {new Date(d.updatedAt).toLocaleString()}
                  </Text>
                </div>
                <Group gap={4}>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Duplicate ${d.name}`}
                    title="Duplicate"
                    onClick={() => duplicate(d.id)}
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
    </Container>
  );
};
