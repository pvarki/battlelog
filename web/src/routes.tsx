import { Anchor, AppShell, Group, Text, VisuallyHidden } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconLoader2, IconPlugConnectedX, IconPointFilled } from "@tabler/icons-react";
import {
  createRootRoute,
  createRoute,
  type ErrorComponentProps,
  Link,
  notFound,
  Outlet,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { AlertsBell } from "./AlertsBell.tsx";
import { type DashboardResponse, dashboardsApi } from "./api.ts";
import { validateEventSearch } from "./event-filters.ts";
import { CONNECTION_LABEL, useConnectionState } from "./live-events.ts";
import { Placeholder } from "./Placeholder.tsx";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { DashboardsPage } from "./pages/DashboardsPage.tsx";
import { EventExplorerPage } from "./pages/EventExplorerPage.tsx";
import { IngestSettingsPage } from "./pages/IngestSettingsPage.tsx";

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

// Stream health. Quiet when live (a bare dot) and labelled the moment it is
// not: the dangerous failure is a stalled stream that still looks healthy, so
// the indicator has to be present enough that its absence registers. Icon
// differs per state, so colour is never the only carrier.
const STREAM_LOOK = {
  live: { Icon: IconPointFilled, c: "success.4" },
  connecting: { Icon: IconLoader2, c: "warning.4" },
  down: { Icon: IconPlugConnectedX, c: "danger.4" },
} as const;

const ConnectionIndicator = () => {
  const state = useConnectionState();
  const label = CONNECTION_LABEL[state];
  const { Icon, c } = STREAM_LOOK[state];
  const previous = useRef(state);

  // A toast on losing/regaining the stream: on a phone the header shows only
  // a small icon, and even on desktop a stalled live log failing silently is
  // the product's core hazard. Transitions only — the initial connect is not
  // an outage.
  useEffect(() => {
    if (state === "down" && previous.current !== "down") {
      notifications.show({
        color: "red",
        title: "Event stream down",
        message: "Live updates are not arriving — data shown may be stale.",
        autoClose: 8000,
      });
    } else if (state === "live" && previous.current === "down") {
      notifications.show({ color: "teal", message: "Event stream reconnected" });
    }
    previous.current = state;
  }, [state]);

  return (
    <Group gap={4} ml="auto" c={c} title={`Event stream: ${label}`} role="status">
      <Icon size={16} stroke={1.5} />
      {state === "live" ? (
        <VisuallyHidden>{label}</VisuallyHidden>
      ) : (
        // Icon-only on phones (the label wraps the 48px header onto the
        // page), but the status text must stay readable to screen readers.
        <>
          <Text fz="xs" visibleFrom="sm">
            {label}
          </Text>
          <VisuallyHidden hiddenFrom="sm">{label}</VisuallyHidden>
        </>
      )}
    </Group>
  );
};

const RootLayout = () => {
  return (
    <AppShell header={{ height: 48 }} padding={0}>
      <AppShell.Header>
        <Group h="100%" px="md" gap="lg" wrap="nowrap">
          <Text fw={700} style={{ letterSpacing: "0.04em" }}>
            BATTLELOG
          </Text>
          <NavLink to="/">Dashboards</NavLink>
          <NavLink to="/events">Event Explorer</NavLink>
          <NavLink to="/ingest">Ingest</NavLink>
          <ConnectionIndicator />
          {/* Alerts live in the header, not on a board: it is the one thing on
              screen on every page, and it costs no tile from the board the alert
              is about. */}
          <AlertsBell />
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
};

/**
 * Every route's failure screen. Loaders throw on a bad response, so this is
 * where a network blip on the most ordinary navigation lands — it renders
 * inside the layout, so the header nav stays available as a way out.
 */
const RouteError = ({ error, reset }: ErrorComponentProps) => {
  const router = useRouter();
  const detail = error instanceof Error && error.message ? error.message : "Something went wrong.";
  return (
    <Placeholder
      title="Couldn't load this"
      detail={detail}
      action={{
        label: "Try again",
        onClick: () => {
          reset();
          void router.invalidate();
        },
      }}
    />
  );
};

const RouteNotFound = () => {
  const navigate = useNavigate();
  return (
    <Placeholder
      title="Nothing here"
      detail="That address doesn't match anything — the dashboard may have been deleted."
      action={{ label: "All dashboards", onClick: () => void navigate({ to: "/" }) }}
    />
  );
};

export const routerDefaults = {
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
};

const rootRoute = createRootRoute({
  component: RootLayout,
  // RootLayout itself throwing has no parent to catch it.
  errorComponent: RouteError,
});

// Offline fallback for the route loaders: the last successful dashboards list,
// one localStorage key. A handful of small JSON docs overwritten on every
// successful load, so no eviction. Saves stay online-only; editing a stale
// copy after reconnect lands in the existing 409 version-conflict path.
const DASHBOARDS_CACHE_KEY = "battlelog.dashboards";

const cacheDashboards = (dashboards: DashboardResponse[]) => {
  try {
    localStorage.setItem(DASHBOARDS_CACHE_KEY, JSON.stringify(dashboards));
  } catch {
    // storage denied — offline reloads just fail as before
  }
};

const cachedDashboards = (): DashboardResponse[] | undefined => {
  try {
    const raw = localStorage.getItem(DASHBOARDS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as DashboardResponse[]) : undefined;
  } catch {
    return undefined;
  }
};

export const dashboardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: async () => {
    try {
      const res = await dashboardsApi.dashboards.$get();
      if (!res.ok) throw new Error(`Failed to load dashboards (${res.status})`);
      const dashboards = await res.json();
      cacheDashboards(dashboards);
      return dashboards;
    } catch (err) {
      // fetch rejects transport failures as TypeError (offline): last-known
      // copy. A server that answered with an error still gets the error
      // screen — cached data must not dress a 500 up as a fresh load.
      if (err instanceof TypeError) return cachedDashboards() ?? Promise.reject(err);
      throw err;
    }
  },
  component: DashboardsPage,
});

export const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/d/$dashboardId",
  loader: async ({ params }) => {
    try {
      const [one, all] = await Promise.all([
        dashboardsApi.dashboards[":dashboardId"].$get({
          param: { dashboardId: params.dashboardId },
        }),
        dashboardsApi.dashboards.$get(),
      ]);
      // A stale link to a deleted dashboard is the likeliest failure on this
      // route, and it deserves the not-found screen rather than a status code.
      if (one.status === 404) throw notFound();
      if (!one.ok || !all.ok) {
        throw new Error(`Failed to load dashboard (${one.status}/${all.status})`);
      }
      const data = { dashboard: await one.json(), dashboards: await all.json() };
      cacheDashboards(data.dashboards);
      return data;
    } catch (err) {
      // fetch rejects transport failures as TypeError (offline): last-known
      // copy. Server-answered errors (403/500, and the 404 above) fall
      // through to their usual screens instead of a stale render.
      if (err instanceof TypeError) {
        const dashboards = cachedDashboards();
        const dashboard = dashboards?.find((d) => d.id === params.dashboardId);
        if (dashboards && dashboard) return { dashboard, dashboards };
      }
      throw err;
    }
  },
  component: DashboardPage,
});

export const eventExplorerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/events",
  validateSearch: validateEventSearch,
  component: EventExplorerPage,
});

export const ingestSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/ingest",
  component: IngestSettingsPage,
});

export const routeTree = rootRoute.addChildren([
  dashboardsRoute,
  dashboardRoute,
  eventExplorerRoute,
  ingestSettingsRoute,
]);
