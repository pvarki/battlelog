import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { api } from "./api.ts";
import { EventsPage } from "./pages/EventsPage.tsx";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

export const eventsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: async () => {
    const res = await api.events.$get({ query: { limit: 100 } });
    if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
    return res.json();
  },
  component: EventsPage,
});

export const routeTree = rootRoute.addChildren([eventsRoute]);
