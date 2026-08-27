import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Loader,
  Menu,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp, IconArrowForwardUp, IconChevronDown } from "@tabler/icons-react";
import { getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { Suspense, useEffect, useEffectEvent, useRef, useState } from "react";
import { GridLayout, getCompactor, type Layout } from "react-grid-layout";
import type { DashboardResponse, Widget } from "../api.ts";
import { dashboardsApi } from "../api.ts";
import { GRID_COLS, GRID_MARGIN, GRID_ROWS, MIN_ROW_HEIGHT } from "../dashboard/grid.ts";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  newHistory,
  record,
  type Snapshot,
  step,
} from "../dashboard/history.ts";
import { MobileSwitcher } from "../dashboard/MobileSwitcher.tsx";
import { useIsMobile } from "../dashboard/mobile.ts";
import { firstFreeSlot } from "../dashboard/placement.ts";
import {
  getWidget,
  registry,
  validateWidgetConfig,
  type WidgetDescriptor,
} from "../dashboard/registry.ts";
import { DOC_STATUS_LABEL, type DocStatus } from "../dashboard/useEventDocument.ts";
import { WidgetWrapper } from "../dashboard/WidgetWrapper.tsx";
import { Placeholder } from "../Placeholder.tsx";
import { useWakeLock } from "../use-wake-lock.ts";

const route = getRouteApi("/d/$dashboardId");

const SAVE_DEBOUNCE_MS = 800;

// Fixed canvas: no compaction (widgets stay where placed) and collisions are
// blocked — plain noCompactor lets a drag push neighbours past the fixed
// bottom row, off the screen.
const fixedCanvasCompactor = getCompactor(null, false, true);

// Shortcut hints are the only place edit-mode keys are discoverable.
const MOD = navigator.platform.includes("Mac") ? "\u2318" : "Ctrl+";

type PendingPatch = { name?: string; widgets?: Widget[] };

export const DashboardPage = () => {
  const { dashboard, dashboards } = route.useLoaderData();
  useWakeLock();
  // Phones get the switcher — one widget fullscreen, bottom bar to change.
  // No edit machinery mounts at all, so mobile editing is disabled by
  // construction, not by flags.
  const isMobile = useIsMobile();
  if (isMobile) {
    return <MobileSwitcher key={`${dashboard.id}:${dashboard.version}`} dashboard={dashboard} />;
  }
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
  // Same vocabulary a widget document uses, so a dashboard save and a widget
  // save read identically. `loading`/`unavailable` never occur here — the
  // router loader owns loading.
  const [saveState, setSaveState] = useState<DocStatus>("idle");
  const [editMode, setEditMode] = useState(false);
  // Undo covers *composition* — layout, widget config, add/remove, the name.
  // Widget content (note text, todo ticks, table cells) lives in its own event
  // chain via useEventDocument and is deliberately not undone here: a stray
  // Cmd-Z must never un-tick someone's checklist.
  //
  // `cursor` indexes the current state; a new edit truncates the redo tail.
  // `key` marks which gesture produced the top entry, so a drag or a run of
  // keystrokes collapses into one entry instead of dozens.
  //
  // ponytail: session-scoped. History dies with this mount — which is also
  // correct on 409, since the key={id}:{version} remount discards snapshots
  // that describe a document the server has moved past. Dashboards are a
  // mutable row (version is an optimistic token, not a chain), so there is no
  // server history to restore from; add a revisions table if recovering across
  // reloads ever matters.
  const history = useRef(newHistory({ name: dashboard.name, widgets: dashboard.widgets }));
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  // The widget just added, so it can animate into the slot that was chosen
  // for it. Never cleared: the CSS animation is one-shot per mount, so a
  // stale id does nothing until the next add replaces it.
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const { ref: gridRef, width, height } = useElementSize();
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const version = useRef(dashboard.version);
  const pending = useRef<PendingPatch | null>(null);
  const saving = useRef(false);

  // Unmount with an unsent edit: fire it keepalive so navigation (or tab
  // close) can't silently drop the last change. If a save is in flight, its
  // loop drains `pending` on its own.
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      clearTimeout(savedTimer.current);
      if (pending.current && !saving.current) {
        fetch(`/api/v1/dashboards/${dashboard.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            version: version.current,
            ...pending.current,
          }),
        }).catch(() => {});
      }
    },
    [dashboard.id],
  );

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === "e") {
      e.preventDefault();
      setEditMode((v) => !v);
      return;
    }
    // Composition only changes in edit mode, so undo only lives there.
    if (!editMode) return;
    // Inside a text field Cmd-Z belongs to the field, not the dashboard.
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) {
      return;
    }
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      jump(-1);
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      jump(1);
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
            // A permanent "Saved" is noise on an ops display: fade to idle.
            clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(
              () => setSaveState((s) => (s === "saved" ? "idle" : s)),
              2000,
            );
          } else if (res.status === 409) {
            // Edited elsewhere: reload server state (remounts via the version key).
            setSaveState("stale");
            router.invalidate();
            return;
          } else if (res.status === 404) {
            // Deleted while we were away — a cached offline copy can outlive
            // its dashboard. Reloading routes to the not-found screen instead
            // of retrying a save that can never land.
            router.invalidate();
            return;
          } else {
            // HTTP error: keep the payload and retry on a timer. Waiting for the
            // user's next keystroke instead would leave "Save failed — retrying"
            // telling the truth only by accident.
            // ponytail: retries forever, even on a permanent 4xx — same ceiling
            // as useEventDocument. Cap it if a bad payload ever hot-loops.
            pending.current = { ...payload, ...(pending.current ?? {}) };
            setSaveState("error");
            saveTimer.current = setTimeout(runSave, 3000);
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
    setSaveState("waiting");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(runSave, SAVE_DEBOUNCE_MS);
  };

  const syncHistoryFlags = () => {
    setCanUndo(historyCanUndo(history.current));
    setCanRedo(historyCanRedo(history.current));
  };

  const remember = (next: Snapshot, coalesceKey: string | null) => {
    record(history.current, next, coalesceKey);
    syncHistoryFlags();
  };

  // Undo/redo replay a snapshot as an ordinary forward save: the stored
  // document only ever moves forward, matching how events themselves work.
  const jump = (delta: number) => {
    const snapshot = step(history.current, delta);
    if (!snapshot) return;
    setWidgets(snapshot.widgets);
    setName(snapshot.name);
    schedule({ name: snapshot.name, widgets: snapshot.widgets });
    syncHistoryFlags();
  };

  const persist = (next: Widget[], coalesceKey: string | null = null) => {
    setWidgets(next);
    remember({ name, widgets: next }, coalesceKey);
    schedule({ widgets: next });
  };

  const rename = (value: string) => {
    setRenaming(false);
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) return;
    setName(trimmed);
    remember({ name: trimmed, widgets }, null);
    schedule({ name: trimmed });
  };

  const onLayoutChange = (layout: Layout) => {
    const next = widgets.map((w) => {
      const item = layout.find((l) => l.i === w.id);
      return item ? { ...w, layout: { x: item.x, y: item.y, w: item.w, h: item.h } } : w;
    });
    // Fires on mount, after compaction no-ops, and twice per drag (once from
    // the drag-stop handler, once from the post-commit effect) — only persist
    // real moves. That also means one drag yields one history entry with no
    // coalescing needed. Field-wise compare: jsonb alphabetizes keys, so
    // stringify always differs.
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

  // The canvas is fixed and blocks collisions, so a new widget needs a slot
  // that is genuinely free. Clamping to the last rows (what this used to do)
  // dropped it on top of whatever was already there, silently.
  const place = (size: { w: number; h: number }) => {
    const slot = firstFreeSlot(
      widgets.map((w) => w.layout),
      size,
      GRID_COLS,
      GRID_ROWS,
    );
    if (!slot) {
      notifications.show({
        color: "red",
        title: "No room on this dashboard",
        message: "Remove or resize a widget to make space.",
      });
    }
    return slot;
  };

  const addWidget = (type: string) => {
    const descriptor = getWidget(type);
    if (!descriptor) return;
    const slot = place(descriptor.defaultSize);
    if (!slot) return;
    setEditMode(true);
    const id = crypto.randomUUID();
    setEnteringId(id);
    persist([
      ...widgets,
      {
        id,
        type,
        config: descriptor.defaultConfig,
        layout: { ...slot, ...descriptor.defaultSize },
      },
    ]);
  };

  const duplicateWidget = (w: Widget) => {
    const slot = place(w.layout);
    if (!slot) return;
    const id = crypto.randomUUID();
    setEnteringId(id);
    persist([...widgets, { ...w, id, layout: { ...w.layout, ...slot } }]);
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
    // Config forms fire per keystroke — collapse them into one undo step.
    persist(
      widgets.map((w) => (w.id === id ? { ...w, config } : w)),
      `config:${id}`,
    );
  };

  const removeWidget = (id: string) => {
    if (configuringId === id) setConfiguringId(null);
    persist(widgets.filter((w) => w.id !== id));
  };

  const configuring = widgets.find((w) => w.id === configuringId) ?? null;
  const configuringDescriptor = configuring ? getWidget(configuring.type) : undefined;

  // Fit the whole board on screen, unless that makes the rows unreadable: then
  // keep them legible and let the container scroll.
  const fittedRowHeight = (height - (GRID_ROWS - 1) * GRID_MARGIN) / GRID_ROWS;
  const rowHeight = Math.max(MIN_ROW_HEIGHT, fittedRowHeight);

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
          ) : editMode ? (
            <UnstyledButton
              onClick={() => setRenaming(true)}
              title="Rename dashboard"
              aria-label={`Rename dashboard ${name}`}
              style={{ cursor: "text" }}
            >
              <Title order={3}>{name}</Title>
            </UnstyledButton>
          ) : (
            <Title order={3}>{name}</Title>
          )}
          {dashboard.isTemplate && (
            <Badge variant="light" color="accent">
              Template
            </Badge>
          )}
          <Menu position="bottom-start">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Switch dashboard">
                <IconChevronDown size={16} stroke={1.5} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {dashboards
                .filter((d) => !d.isTemplate)
                .map((d) => (
                  <Menu.Item
                    key={d.id}
                    disabled={d.id === dashboard.id}
                    onClick={() =>
                      navigate({
                        to: "/d/$dashboardId",
                        params: { dashboardId: d.id },
                      })
                    }
                  >
                    {d.name}
                  </Menu.Item>
                ))}
              <Menu.Divider />
              <Menu.Item onClick={() => navigate({ to: "/" })}>All dashboards…</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Text c={saveState === "error" ? "danger.4" : "dimmed"} fz="xs" role="status">
            {DOC_STATUS_LABEL[saveState]}
          </Text>
        </Group>
        <Group gap="xs">
          {editMode && (
            <>
              <ActionIcon
                variant="default"
                size="input-sm"
                aria-label="Undo"
                title={`Undo (${MOD}Z)`}
                disabled={!canUndo}
                onClick={() => jump(-1)}
              >
                <IconArrowBackUp size={18} stroke={1.5} />
              </ActionIcon>
              <ActionIcon
                variant="default"
                size="input-sm"
                aria-label="Redo"
                title={`Redo (${MOD}\u21E7Z)`}
                disabled={!canRedo}
                onClick={() => jump(1)}
              >
                <IconArrowForwardUp size={18} stroke={1.5} />
              </ActionIcon>
            </>
          )}
          {editMode && (
            // Composing a board means several picks in a row — closing after
            // each one turns that into a round-trip per widget.
            <Menu position="bottom-end" closeOnItemClick={false}>
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
            title={`Toggle edit mode (${MOD}E)`}
          >
            {editMode ? "Done" : "Edit"}
          </Button>
        </Group>
      </Group>

      {/* auto, not hidden: the board only overflows once rows hit their floor,
          and losing widgets off the bottom of the screen is worse than a
          scrollbar. */}
      <Box ref={gridRef} flex={1} mih={0} style={{ overflowY: "auto", overflowX: "hidden" }}>
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
                  onUpdateConfig={(config) => updateWidgetConfig(w.id, config)}
                  entering={w.id === enteringId}
                />
              </div>
            ))}
          </GridLayout>
        )}
        {widgets.length === 0 && (
          <Placeholder
            title="Empty dashboard"
            detail={
              editMode
                ? "Use Add widget above to place your first one."
                : "Widgets are placed in edit mode — clocks, event feeds, status boards, forms."
            }
            action={editMode ? undefined : { label: "Edit", onClick: () => setEditMode(true) }}
          />
        )}
      </Box>

      <Drawer
        opened={!!configuring}
        onClose={() => setConfiguringId(null)}
        position="right"
        title={configuring ? `${configuringDescriptor?.name ?? configuring.type} settings` : ""}
      >
        {configuring && configuringDescriptor && (
          <WidgetConfigPanel
            widget={configuring}
            descriptor={configuringDescriptor}
            onChange={(next) => updateWidgetConfig(configuring.id, next)}
          />
        )}
      </Drawer>
    </Box>
  );
};

const WidgetConfigPanel = ({
  widget,
  descriptor,
  onChange,
}: {
  widget: Widget;
  descriptor: WidgetDescriptor;
  onChange: (next: unknown) => void;
}) => {
  const ConfigForm = descriptor.ConfigForm;
  const validation = validateWidgetConfig(widget.type, widget.config);
  const formConfig = validation.ok
    ? validation.value
    : {
        ...(descriptor.defaultConfig as Record<string, unknown>),
        ...(widget.config as Record<string, unknown>),
      };
  return (
    <Stack>
      {descriptor.showOnMobile !== false && (
        <Switch
          label="Show on mobile"
          description="Include this widget in the phone view of the dashboard"
          checked={(formConfig as { showOnMobile?: boolean }).showOnMobile !== false}
          onChange={(e) =>
            onChange({
              ...(formConfig as Record<string, unknown>),
              showOnMobile: e.currentTarget.checked,
            })
          }
        />
      )}
      {ConfigForm && (
        <Suspense fallback={<Loader size="sm" />}>
          <ConfigForm config={formConfig} onChange={onChange} />
        </Suspense>
      )}
    </Stack>
  );
};
