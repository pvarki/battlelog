import {
  ActionIcon,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  Menu,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { Suspense, useEffect, useRef, useState } from "react";
import { GridLayout, getCompactor, type Layout } from "react-grid-layout";
import type { DashboardResponse, Widget } from "../api.ts";
import { dashboardsApi } from "../api.ts";
import { getWidget, registry, validateWidgetConfig } from "../dashboard/registry.ts";
import { WidgetWrapper } from "../dashboard/WidgetWrapper.tsx";

const route = getRouteApi("/d/$dashboardId");

// Wall-display grid: fills the viewport exactly (no scrolling), sized for
// FullHD. Rows/cols are fixed; cell size derives from the available space.
const GRID_COLS = 48;
const GRID_ROWS = 24;
const GRID_MARGIN = 8;
const SAVE_DEBOUNCE_MS = 800;

// Fixed canvas: no compaction (widgets stay where placed) and collisions are
// blocked — plain noCompactor lets a drag push neighbours past the fixed
// bottom row, off the screen.
const fixedCanvasCompactor = getCompactor(null, false, true);

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";
type PendingPatch = { name?: string; widgets?: Widget[] };

export const DashboardPage = () => {
  const { dashboard, dashboards } = route.useLoaderData();
  // Key by version too: a conflict reload must remount with fresh server state.
  return (
    <DashboardGrid
      key={`${dashboard.id}:${dashboard.version}`}
      dashboard={dashboard}
      dashboards={dashboards}
    />
  );
};

const DashboardGrid = ({
  dashboard,
  dashboards,
}: {
  dashboard: DashboardResponse;
  dashboards: DashboardResponse[];
}) => {
  const router = useRouter();
  const navigate = useNavigate();
  const [widgets, setWidgets] = useState<Widget[]>(dashboard.widgets);
  const [name, setName] = useState(dashboard.name);
  const [renaming, setRenaming] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [editMode, setEditMode] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const { ref: gridRef, width, height } = useElementSize();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const version = useRef(dashboard.version);
  const pending = useRef<PendingPatch | null>(null);
  const saving = useRef(false);

  // Unmount with an unsent edit: fire it keepalive so navigation (or tab
  // close) can't silently drop the last change. If a save is in flight, its
  // loop drains `pending` on its own.
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      if (pending.current && !saving.current) {
        fetch(`/api/v1/dashboards/${dashboard.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ version: version.current, ...pending.current }),
        }).catch(() => {});
      }
    },
    [dashboard.id],
  );

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

  // One save in flight at a time: overlapping PATCHes would read a stale
  // version ref and self-409, discarding the user's own newer edit. The loop
  // drains `pending`, so edits made mid-save coalesce into the next PATCH.
  const runSave = async () => {
    if (saving.current) return;
    saving.current = true;
    try {
      while (pending.current) {
        const payload = pending.current;
        pending.current = null;
        setSaveState("saving");
        try {
          const res = await dashboardsApi.dashboards[":dashboardId"].$patch({
            param: { dashboardId: dashboard.id },
            json: { version: version.current, ...payload },
          });
          if (res.status === 200) {
            version.current = (await res.json()).version;
            setSaveState("saved");
          } else if (res.status === 409) {
            // Edited elsewhere: reload server state (remounts via the version key).
            setSaveState("conflict");
            router.invalidate();
            return;
          } else {
            setSaveState("error");
            return;
          }
        } catch {
          // Network blip: keep the newest unsaved state and retry shortly.
          pending.current = { ...payload, ...(pending.current ?? {}) };
          setSaveState("error");
          saveTimer.current = setTimeout(runSave, 3000);
          return;
        }
      }
    } finally {
      saving.current = false;
    }
  };

  const schedule = (patch: PendingPatch) => {
    pending.current = { ...pending.current, ...patch };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(runSave, SAVE_DEBOUNCE_MS);
  };

  const persist = (next: Widget[]) => {
    setWidgets(next);
    schedule({ widgets: next });
  };

  const rename = (value: string) => {
    setRenaming(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) return;
    setName(trimmed);
    schedule({ name: trimmed });
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

  // The grid has a fixed row count, so clamp new items into the last rows
  // instead of appending past the bottom edge.
  const placeAt = (list: Widget[], h: number) =>
    Math.max(
      0,
      Math.min(
        list.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0),
        GRID_ROWS - h,
      ),
    );

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
        layout: { x: 0, y: placeAt(widgets, descriptor.defaultSize.h), ...descriptor.defaultSize },
      },
    ]);
  };

  const duplicateWidget = (w: Widget) => {
    persist([
      ...widgets,
      {
        ...w,
        id: crypto.randomUUID(),
        layout: { ...w.layout, x: 0, y: placeAt(widgets, w.layout.h) },
      },
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

  const updateWidgetConfig = (id: string, config: unknown) => {
    persist(widgets.map((w) => (w.id === id ? { ...w, config } : w)));
  };

  const removeWidget = (id: string) => {
    if (configuringId === id) setConfiguringId(null);
    persist(widgets.filter((w) => w.id !== id));
  };

  const configuring = widgets.find((w) => w.id === configuringId) ?? null;
  const configuringDescriptor = configuring ? getWidget(configuring.type) : undefined;

  const rowHeight = Math.max(8, (height - (GRID_ROWS - 1) * GRID_MARGIN) / GRID_ROWS);

  return (
    <Box
      px="md"
      py="sm"
      h="calc(100dvh - 48px)"
      style={{ display: "flex", flexDirection: "column" }}
    >
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          {renaming ? (
            <TextInput
              size="xs"
              w={260}
              defaultValue={name}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") rename(e.currentTarget.value);
                if (e.key === "Escape") setRenaming(false);
              }}
              onBlur={(e) => rename(e.currentTarget.value)}
            />
          ) : (
            <Title
              order={3}
              onClick={() => editMode && setRenaming(true)}
              style={{ cursor: editMode ? "text" : "default" }}
              title={editMode ? "Click to rename" : undefined}
            >
              {name}
            </Title>
          )}
          <Menu position="bottom-start">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Switch dashboard">
                ▾
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {dashboards.map((d) => (
                <Menu.Item
                  key={d.id}
                  disabled={d.id === dashboard.id}
                  onClick={() => navigate({ to: "/d/$dashboardId", params: { dashboardId: d.id } })}
                >
                  {d.name}
                </Menu.Item>
              ))}
              <Menu.Divider />
              <Menu.Item onClick={() => navigate({ to: "/" })}>All dashboards…</Menu.Item>
            </Menu.Dropdown>
          </Menu>
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

      <Box ref={gridRef} flex={1} mih={0} style={{ overflow: "hidden" }}>
        {width > 0 && height > 0 && (
          <GridLayout
            width={width}
            autoSize={false}
            layout={widgets.map((w) => ({
              i: w.id,
              ...w.layout,
              minW: getWidget(w.type)?.minSize.w,
              minH: getWidget(w.type)?.minSize.h,
            }))}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight,
              margin: [GRID_MARGIN, GRID_MARGIN],
              containerPadding: [0, 0],
              maxRows: GRID_ROWS,
            }}
            compactor={fixedCanvasCompactor}
            dragConfig={{ enabled: editMode, handle: ".widget-drag-handle" }}
            resizeConfig={{ enabled: editMode }}
            onLayoutChange={onLayoutChange}
          >
            {widgets.map((w) => (
              <div key={w.id}>
                <WidgetWrapper
                  instance={w}
                  editMode={editMode}
                  onConfigure={() => setConfiguringId(w.id)}
                  onRemove={() => removeWidget(w.id)}
                  onDuplicate={() => duplicateWidget(w)}
                  onResetSize={() => resetWidgetSize(w.id)}
                  onResetConfig={() => resetWidgetConfig(w.id)}
                />
              </div>
            ))}
          </GridLayout>
        )}
        {widgets.length === 0 && (
          <Text c="dimmed" ta="center" mt="xl">
            Empty dashboard — {editMode ? "add a widget to get started." : "press Edit to compose."}
          </Text>
        )}
      </Box>

      <Drawer
        opened={!!configuring}
        onClose={() => setConfiguringId(null)}
        position="right"
        title={configuring ? `${configuringDescriptor?.name ?? configuring.type} settings` : ""}
      >
        {configuring &&
          configuringDescriptor?.ConfigForm &&
          (() => {
            const validation = validateWidgetConfig(configuring.type, configuring.config);
            const ConfigForm = configuringDescriptor.ConfigForm;
            return (
              <Suspense fallback={<Loader size="sm" />}>
                <ConfigForm
                  config={validation.ok ? validation.value : configuringDescriptor.defaultConfig}
                  onChange={(next) => updateWidgetConfig(configuring.id, next)}
                />
              </Suspense>
            );
          })()}
      </Drawer>
    </Box>
  );
};
