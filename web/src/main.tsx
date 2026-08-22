import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "react-grid-layout/css/styles.css";
import "@fontsource-variable/inter";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routerDefaults, routeTree } from "./routes.tsx";
import { theme } from "./theme.ts";

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
