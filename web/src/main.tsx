import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "react-grid-layout/css/styles.css";
import "@fontsource-variable/inter";
import "./global.css";
import { registerSW } from "virtual:pwa-register";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routerDefaults, routeTree } from "./routes.tsx";
import { theme } from "./theme.ts";

// Without importing the virtual module, autoUpdate installs the new service
// worker but never reloads open tabs — a wall display would run last month's
// build forever, and its purged old chunks would 404 on lazy widget loads.
// The reload is deliberate: config forms persist every keystroke to the
// server (see web/CLAUDE.md), so an unannounced reload loses nothing durable.
registerSW({ immediate: true });

const router = createRouter({ routeTree, ...routerDefaults });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <Notifications position="bottom-right" />
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
);
