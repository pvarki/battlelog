import { Anchor, AppShell, Center, Group, Stack, Text, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { createRootRoute, createRoute, Link, Outlet } from "@tanstack/react-router";
import { dashboardsApi } from "./api.ts";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { DashboardsPage } from "./pages/DashboardsPage.tsx";
import { EventExplorerPage, validateEventSearch } from "./pages/EventExplorerPage.tsx";

// The current page renders full-strength; elsewhere links stay dimmed.
const NavLink = ({ to, children }: { to: string; children: string }) => (
  <Anchor
    fz="sm"
    c="dimmed"
    renderRoot={(props) => (
      <Link
        to={to}
        activeOptions={{ exact: to === "/" }}
        activeProps={{ style: { color: "var(--mantine-color-dark-0)", fontWeight: 600 } }}
        {...props}
      />
    )}
  >
    {children}
  </Anchor>
);

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
            BattleLog needs a screen at least 1280 px wide — use a desktop or laptop display. Mobile
            is not supported yet.
          </Text>
        </Stack>
      </Center>
    );
  }

  return (
    <AppShell header={{ height: 48 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" gap="lg">
          <Text fw={700} style={{ letterSpacing: "0.04em" }}>
            BATTLELOG
          </Text>
          <NavLink to="/">Dashboards</NavLink>
          <NavLink to="/events">Event Explorer</NavLink>
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
    const [one, all] = await Promise.all([
      dashboardsApi.dashboards[":dashboardId"].$get({
        param: { dashboardId: params.dashboardId },
      }),
      dashboardsApi.dashboards.$get(),
    ]);
    if (!one.ok || !all.ok) {
      throw new Error(`Failed to load dashboard (${one.status}/${all.status})`);
    }
    return { dashboard: await one.json(), dashboards: await all.json() };
  },
  component: DashboardPage,
});

export const eventExplorerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  validateSearch: validateEventSearch,
  component: EventExplorerPage,
});

export const routeTree = rootRoute.addChildren([
  dashboardsRoute,
  dashboardRoute,
  eventExplorerRoute,
]);
