import { Box, Button, Group, Menu, Text, Title } from "@mantine/core";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { GridLayout, type Layout, useContainerWidth } from "react-grid-layout";
import type { DashboardResponse, Widget } from "../api.ts";
import { dashboardsApi } from "../api.ts";
import { getWidget, registry } from "../dashboard/registry.ts";
import { WidgetWrapper } from "../dashboard/WidgetWrapper.tsx";

const route = getRouteApi("/d/$dashboardId");

const GRID_COLS = 24;
const ROW_HEIGHT = 40;
const SAVE_DEBOUNCE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export const DashboardPage = () => {
  const dashboard = route.useLoaderData();
  // Key by version too: a conflict reload must remount with fresh server state.
  return <DashboardGrid key={`${dashboard.id}:${dashboard.version}`} dashboard={dashboard} />;
};

const DashboardGrid = ({ dashboard }: { dashboard: DashboardResponse }) => {
  const router = useRouter();
  const [widgets, setWidgets] = useState<Widget[]>(dashboard.widgets);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [editMode, setEditMode] = useState(false);
  const { width, mounted, containerRef } = useContainerWidth();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const version = useRef(dashboard.version);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "e") {
        e.preventDefault();
        setEditMode((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const persist = (next: Widget[]) => {
    setWidgets(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveState("saving");
      const res = await dashboardsApi.dashboards[":dashboardId"].$patch({
        param: { dashboardId: dashboard.id },
        json: { version: version.current, widgets: next },
      });
      if (res.status === 200) {
        version.current = (await res.json()).version;
        setSaveState("saved");
      } else if (res.status === 409) {
        // Edited elsewhere: reload server state (remounts via the version key).
        setSaveState("conflict");
        router.invalidate();
      } else {
        setSaveState("error");
      }
    }, SAVE_DEBOUNCE_MS);
  };

  const onLayoutChange = (layout: Layout) => {
    const next = widgets.map((w) => {
      const item = layout.find((l) => l.i === w.id);
      return item ? { ...w, layout: { x: item.x, y: item.y, w: item.w, h: item.h } } : w;
    });
    // Fires on mount and after compaction no-ops — only persist real moves.
    // Field-wise compare: jsonb alphabetizes keys, so stringify always differs.
    const moved = next.some((w, i) => {
      const prev = widgets[i]?.layout;
      return (
        !prev ||
        prev.x !== w.layout.x ||
        prev.y !== w.layout.y ||
        prev.w !== w.layout.w ||
        prev.h !== w.layout.h
      );
    });
    if (moved) persist(next);
  };

  const bottomOf = (list: Widget[]) =>
    list.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0);

  const addWidget = (type: string) => {
    const descriptor = getWidget(type);
    if (!descriptor) return;
    setEditMode(true);
    persist([
      ...widgets,
      {
        id: crypto.randomUUID(),
        type,
        config: descriptor.defaultConfig,
        layout: { x: 0, y: bottomOf(widgets), ...descriptor.defaultSize },
      },
    ]);
  };

  const duplicateWidget = (w: Widget) => {
    persist([
      ...widgets,
      { ...w, id: crypto.randomUUID(), layout: { ...w.layout, x: 0, y: bottomOf(widgets) } },
    ]);
  };

  const resetWidgetSize = (id: string) => {
    persist(
      widgets.map((w) => {
        const descriptor = getWidget(w.type);
        return w.id === id && descriptor
          ? { ...w, layout: { ...w.layout, ...descriptor.defaultSize } }
          : w;
      }),
    );
  };

  const resetWidgetConfig = (id: string) => {
    persist(
      widgets.map((w) => {
        const descriptor = getWidget(w.type);
        return w.id === id && descriptor ? { ...w, config: descriptor.defaultConfig } : w;
      }),
    );
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
            {saveState === "conflict" && "Edited elsewhere — reloading…"}
          </Text>
        </Group>
        <Group gap="xs">
          {editMode && (
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="light">Add widget</Button>
              </Menu.Target>
              <Menu.Dropdown>
                {[...registry.values()].map((d) => (
                  <Menu.Item key={d.type} onClick={() => addWidget(d.type)}>
                    <Text fz="sm">{d.name}</Text>
                    {d.description && (
                      <Text fz="xs" c="dimmed">
                        {d.description}
                      </Text>
                    )}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
          <Button
            variant={editMode ? "filled" : "default"}
            onClick={() => setEditMode((v) => !v)}
            title="Toggle edit mode (⌘E)"
          >
            {editMode ? "Done" : "Edit"}
          </Button>
        </Group>
      </Group>

      <div ref={containerRef}>
        {mounted && (
          <GridLayout
            width={width}
            layout={widgets.map((w) => ({
              i: w.id,
              ...w.layout,
              minW: getWidget(w.type)?.minSize.w,
              minH: getWidget(w.type)?.minSize.h,
            }))}
            gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT }}
            dragConfig={{ enabled: editMode, handle: ".widget-drag-handle" }}
            resizeConfig={{ enabled: editMode }}
            onLayoutChange={onLayoutChange}
          >
            {widgets.map((w) => (
              <div key={w.id}>
                <WidgetWrapper
                  instance={w}
                  editMode={editMode}
                  onRemove={() => removeWidget(w.id)}
                  onDuplicate={() => duplicateWidget(w)}
                  onResetSize={() => resetWidgetSize(w.id)}
                  onResetConfig={() => resetWidgetConfig(w.id)}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>
      {widgets.length === 0 && (
        <Text c="dimmed" ta="center" mt="xl">
          Empty dashboard — {editMode ? "add a widget to get started." : "press Edit to compose."}
        </Text>
      )}
    </Box>
  );
};
