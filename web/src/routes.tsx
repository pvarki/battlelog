import { Anchor, AppShell, Center, Group, Stack, Text, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { createRootRoute, createRoute, Link, Outlet } from "@tanstack/react-router";
import { api, dashboardsApi } from "./api.ts";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { DashboardsPage } from "./pages/DashboardsPage.tsx";
import { EventsPage } from "./pages/EventsPage.tsx";

const RootLayout = () => {
  // Desktop-only for now: FullHD is the design target, small screens get an error.
  const tooNarrow = useMediaQuery("(max-width: 1279px)", false, {
    getInitialValueInEffect: false,
  });

  if (tooNarrow) {
    return (
      <Center h="100vh" p="md">
        <Stack align="center" gap="xs">
          <Title order={3}>Screen too small</Title>
          <Text c="dimmed" ta="center">
            BattleLog requires a desktop display (1920×1080). Mobile is not supported yet.
          </Text>
        </Stack>
      </Center>
    );
  }

  return (
    <AppShell header={{ height: 48 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" gap="lg">
          <Text fw={700}>BattleLog</Text>
          <Anchor fz="sm" c="dimmed" renderRoot={(props) => <Link to="/" {...props} />}>
            Dashboards
          </Anchor>
          <Anchor fz="sm" c="dimmed" renderRoot={(props) => <Link to="/events" {...props} />}>
            Events
          </Anchor>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
};

const rootRoute = createRootRoute({
  component: RootLayout,
});

export const dashboardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: async () => {
    const res = await dashboardsApi.dashboards.$get();
    if (!res.ok) throw new Error(`Failed to load dashboards (${res.status})`);
    return res.json();
  },
  component: DashboardsPage,
});

export const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/d/$dashboardId",
  loader: async ({ params }) => {
    const res = await dashboardsApi.dashboards[":dashboardId"].$get({
      param: { dashboardId: params.dashboardId },
    });
    if (!res.ok) throw new Error(`Failed to load dashboard (${res.status})`);
    return res.json();
  },
  component: DashboardPage,
});

export const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  loader: async () => {
    const res = await api.events.$get({ query: { limit: 100 } });
    if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
    return res.json();
  },
  component: EventsPage,
});

export const routeTree = rootRoute.addChildren([dashboardsRoute, dashboardRoute, eventsRoute]);
