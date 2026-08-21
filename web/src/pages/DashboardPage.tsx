import { Box, Button, CloseButton, Group, Menu, Paper, Text, Title } from "@mantine/core";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { GridLayout, type Layout, useContainerWidth } from "react-grid-layout";
import type { DashboardResponse, Widget } from "../api.ts";
import { dashboardsApi } from "../api.ts";
import { WIDGET_REGISTRY, WIDGET_TYPES, type WidgetType } from "../widgets/registry.ts";

const route = getRouteApi("/d/$dashboardId");

const GRID_COLS = 24;
const ROW_HEIGHT = 40;
const SAVE_DEBOUNCE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error";

export const DashboardPage = () => {
  const dashboard = route.useLoaderData();
  // Remount the grid (fresh widget state) when navigating between dashboards.
  return <DashboardGrid key={dashboard.id} dashboard={dashboard} />;
};

const DashboardGrid = ({ dashboard }: { dashboard: DashboardResponse }) => {
  const [widgets, setWidgets] = useState<Widget[]>(dashboard.widgets);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const { width, mounted, containerRef } = useContainerWidth();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const persist = (next: Widget[]) => {
    setWidgets(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      const res = await dashboardsApi.dashboards[":dashboardId"].$patch({
        param: { dashboardId: dashboard.id },
        json: { widgets: next },
      });
      setSaveState(res.ok ? "saved" : "error");
    }, SAVE_DEBOUNCE_MS);
  };

  const onLayoutChange = (layout: Layout) => {
    const next = widgets.map((w) => {
      const item = layout.find((l) => l.i === w.id);
      return item ? { ...w, x: item.x, y: item.y, w: item.w, h: item.h } : w;
    });
    // Fires on mount and after compaction no-ops — only persist real moves.
    if (JSON.stringify(next) !== JSON.stringify(widgets)) persist(next);
  };

  const addWidget = (type: WidgetType) => {
    const def = WIDGET_REGISTRY[type];
    const bottom = widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0);
    persist([...widgets, { id: crypto.randomUUID(), type, x: 0, y: bottom, ...def.defaultSize }]);
  };

  const removeWidget = (id: string) => {
    persist(widgets.filter((w) => w.id !== id));
  };

  return (
    <Box px="md" py="sm">
      <Group justify="space-between" mb="sm">
        <Group gap="sm">
          <Title order={3}>{dashboard.name}</Title>
          <Text c="dimmed" fz="xs">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved"}
            {saveState === "error" && "Save failed — changes not stored"}
          </Text>
        </Group>
        <Menu position="bottom-end">
          <Menu.Target>
            <Button variant="light">Add widget</Button>
          </Menu.Target>
          <Menu.Dropdown>
            {WIDGET_TYPES.map((type) => (
              <Menu.Item key={type} onClick={() => addWidget(type)}>
                {WIDGET_REGISTRY[type].title}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>

      <div ref={containerRef}>
        {mounted && (
          <GridLayout
            width={width}
            layout={widgets.map((w) => ({
              i: w.id,
              x: w.x,
              y: w.y,
              w: w.w,
              h: w.h,
              ...WIDGET_REGISTRY[w.type].minSize,
            }))}
            gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT }}
            dragConfig={{ handle: ".widget-drag-handle" }}
            onLayoutChange={onLayoutChange}
          >
            {widgets.map((w) => (
              <div key={w.id}>
                <WidgetFrame widget={w} onRemove={() => removeWidget(w.id)} />
              </div>
            ))}
          </GridLayout>
        )}
      </div>
      {widgets.length === 0 && (
        <Text c="dimmed" ta="center" mt="xl">
          Empty dashboard — add a widget to get started.
        </Text>
      )}
    </Box>
  );
};

const WidgetFrame = ({ widget, onRemove }: { widget: Widget; onRemove: () => void }) => {
  const def = WIDGET_REGISTRY[widget.type];
  const Body = def.component;
  return (
    <Paper withBorder h="100%" style={{ display: "flex", flexDirection: "column" }}>
      <Group
        className="widget-drag-handle"
        justify="space-between"
        px="xs"
        py={4}
        style={{ cursor: "grab", borderBottom: "1px solid var(--mantine-color-dark-4)" }}
      >
        <Text fz="xs" fw={500} c="dimmed">
          {def.title}
        </Text>
        <CloseButton size="sm" aria-label="Remove widget" onClick={onRemove} />
      </Group>
      <Box flex={1} mih={0}>
        <Body />
      </Box>
    </Paper>
  );
};
