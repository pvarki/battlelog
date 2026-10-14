import { Anchor, AppShell, Burger, Group, Text, VisuallyHidden } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconLoader2, IconPlugConnectedX, IconPointFilled } from "@tabler/icons-react";
import {
  createRootRoute,
  createRoute,
  type ErrorComponentProps,
  Link,
  lazyRouteComponent,
  notFound,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import { z } from "zod";
import { type DashboardResponse, dashboardsApi } from "./api.ts";
import { Placeholder } from "./components/Placeholder.tsx";
import { DashboardNav } from "./dashboard/DashboardNav.tsx";
import { validateEventSearch } from "./events/event-filters.ts";
import { CONNECTION_LABEL, useConnectionState } from "./events/live-events.ts";
import { DashboardPage } from "./pages/DashboardPage.tsx";
import { DashboardsPage } from "./pages/DashboardsPage.tsx";
import { EventExplorerPage } from "./pages/EventExplorerPage.tsx";
import { TakIndicator } from "./tak/TakIndicator.tsx";
import { useIsMobile } from "./viewport.ts";

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

// Without `dashboards` (the root loader itself failed) the panel is left out,
// but the header still renders so its nav remains a way out.
const Shell = ({
  dashboards,
  children,
}: {
  dashboards?: DashboardResponse[];
  children: ReactNode;
}) => {
  // Phones already have their own switchers; the panel is a desktop affordance.
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useLocalStorage({ key: "battlelog.nav-open", defaultValue: true });
  // The map needs the width; its own drawers replace the views panel there.
  const onMap = useRouterState({ select: (s) => s.location.pathname === "/map" });
  const hasNav = !!dashboards && !isMobile && !onMap;
  return (
    <AppShell
      header={{ height: 48 }}
      navbar={{
        width: 260,
        breakpoint: "sm",
        collapsed: { mobile: true, desktop: !hasNav || !navOpen },
      }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="lg" wrap="nowrap">
          {hasNav && (
            <Burger
              size="sm"
              opened={navOpen}
              onClick={() => setNavOpen((v) => !v)}
              aria-label={navOpen ? "Hide views panel" : "Show views panel"}
            />
          )}
          <Text fw={700} style={{ letterSpacing: "0.04em" }}>
            BATTLELOG
          </Text>
          <NavLink to="/">Home</NavLink>
          <NavLink to="/events">Event Explorer</NavLink>
          <NavLink to="/map">Map</NavLink>
          <Group gap="md" ml="auto" wrap="nowrap">
            <TakIndicator />
            <ConnectionIndicator />
          </Group>
        </Group>
      </AppShell.Header>
      {hasNav && (
        <AppShell.Navbar>
          <DashboardNav dashboards={dashboards} />
        </AppShell.Navbar>
      )}
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
};

const RootLayout = () => (
  <Shell dashboards={rootRoute.useLoaderData()}>
    <Outlet />
  </Shell>
);

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
      detail="That address doesn't match anything — the view may have been deleted."
      action={{ label: "Home", onClick: () => void navigate({ to: "/" }) }}
    />
  );
};

export const routerDefaults = {
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
};

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

// The list lives on the root so the side panel has it on every page, and one
// router.invalidate() after a create/rename/delete refreshes panel and page alike.
const rootRoute = createRootRoute({
  loader: async () => {
    try {
      const res = await dashboardsApi.dashboards.$get();
      if (!res.ok) throw new Error(`Failed to load views (${res.status})`);
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
  component: RootLayout,
  // Neither RootLayout nor the root loader has a parent to catch it.
  errorComponent: (props) => (
    <Shell>
      <RouteError {...props} />
    </Shell>
  ),
});

export const dashboardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardsPage,
});

// `event`: the event a widget selected (a feed row click) for others to act on,
// e.g. a form loading it for editing. Malformed values degrade to none.
// The dashboard's selection, which widgets follow: a log event, or a TAK item by uid.
const dashboardSearchSchema = z.object({
  event: z.string().uuid().optional().catch(undefined),
  tak: z.string().min(1).max(200).optional().catch(undefined),
});

export const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/d/$dashboardId",
  validateSearch: (search: unknown) => dashboardSearchSchema.parse(search),
  loader: async ({ params }) => {
    try {
      const res = await dashboardsApi.dashboards[":dashboardId"].$get({
        param: { dashboardId: params.dashboardId },
      });
      // A stale link to a deleted dashboard is the likeliest failure on this
      // route, and it deserves the not-found screen rather than a status code.
      if (res.status === 404) throw notFound();
      if (!res.ok) throw new Error(`Failed to load view (${res.status})`);
      return await res.json();
    } catch (err) {
      // fetch rejects transport failures as TypeError (offline): last-known
      // copy. Server-answered errors (403/500, and the 404 above) fall
      // through to their usual screens instead of a stale render.
      if (err instanceof TypeError) {
        const dashboard = cachedDashboards()?.find((d) => d.id === params.dashboardId);
        if (dashboard) return dashboard;
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

// Lazy: MapLibre is a large chunk that only the map needs.
export const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/map",
  component: lazyRouteComponent(() => import("./pages/MapPage.tsx"), "MapPage"),
});

export const routeTree = rootRoute.addChildren([
  dashboardsRoute,
  dashboardRoute,
  eventExplorerRoute,
  mapRoute,
]);
