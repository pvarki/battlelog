import "@mantine/core/styles.css";
import "react-grid-layout/css/styles.css";
import { MantineProvider } from "@mantine/core";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routes.tsx";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

createRoot(rootEl).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <RouterProvider router={router} />
    </MantineProvider>
  </StrictMode>,
);
