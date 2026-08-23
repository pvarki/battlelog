import { ActionIcon, Box, Drawer, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconMenu2 } from "@tabler/icons-react";
import { useRef, useState } from "react";
import type { DashboardResponse, Widget } from "../api.ts";
import { Placeholder } from "../Placeholder.tsx";
import { mobileWidgets } from "./mobile.ts";
import { getWidget, type WidgetDescriptor } from "./registry.ts";
import { WidgetWrapper } from "./WidgetWrapper.tsx";

const BAR_HEIGHT = 64;
const MAX_BAR_BUTTONS = 5;
const SWIPE_MIN_PX = 48;

const lastViewedKey = (dashboardId: string) => `battlelog.mobile.active.${dashboardId}`;

const widgetLabel = (w: Widget, descriptor: WidgetDescriptor) => {
  const title = (w.config as { title?: unknown } | null)?.title;
  return typeof title === "string" && title.trim() ? title : descriptor.name;
};

const noop = () => {};

/**
 * Phone rendering of a dashboard: one widget fullscreen at a time, a bottom
 * bar to switch. Deliberately read-focused — no edit mode, no widget config,
 * no layout changes. Widget *content* interaction (form submits, todo ticks)
 * works as on desktop, since Views own that via useEventDocument.
 */
export const MobileSwitcher = ({ dashboard }: { dashboard: DashboardResponse }) => {
  const widgets = mobileWidgets(dashboard.widgets);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(lastViewedKey(dashboard.id));
    } catch {
      return null;
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const swipeBlocked = useRef(false);

  const active = widgets.find((w) => w.id === activeId) ?? widgets[0];

  const activate = (id: string) => {
    setActiveId(id);
    setMenuOpen(false);
    try {
      localStorage.setItem(lastViewedKey(dashboard.id), id);
    } catch {
      // per-viewer convenience only
    }
  };

  const swipeTo = (delta: number) => {
    if (!active) return;
    const index = widgets.findIndex((w) => w.id === active.id);
    const next = widgets[index + delta];
    if (next) activate(next.id);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
    // Swipe yields to content that scrolls horizontally (feed tables etc.):
    // native scrolling wins over widget switching.
    // ponytail: any horizontally-scrollable ancestor blocks the swipe in both
    // directions; make it direction-aware (scrollLeft vs max) if it annoys.
    swipeBlocked.current = false;
    let el = e.target as HTMLElement | null;
    while (el && el !== e.currentTarget) {
      if (el.scrollWidth > el.clientWidth + 1) {
        swipeBlocked.current = true;
        break;
      }
      el = el.parentElement;
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || swipeBlocked.current) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    swipeTo(dx < 0 ? 1 : -1);
  };

  if (!active) {
    return (
      <Box h="calc(100dvh - 48px)">
        <Placeholder
          title="No widgets for mobile"
          detail="This dashboard has no widgets enabled for mobile — configure widgets on a desktop."
        />
      </Box>
    );
  }

  const overflowing = widgets.length > MAX_BAR_BUTTONS;
  const barWidgets = overflowing ? widgets.slice(0, MAX_BAR_BUTTONS - 1) : widgets;

  return (
    <Box h="calc(100dvh - 48px)" style={{ display: "flex", flexDirection: "column" }}>
      <Box flex={1} mih={0} p="xs" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <WidgetWrapper
          key={active.id}
          instance={active}
          editMode={false}
          onConfigure={noop}
          onRemove={noop}
          onDuplicate={noop}
          onResetSize={noop}
          onResetConfig={noop}
          onUpdateConfig={noop}
        />
      </Box>
      <Group
        h={BAR_HEIGHT}
        gap={0}
        wrap="nowrap"
        style={{ borderTop: "1px solid var(--mantine-color-dark-4)", flexShrink: 0 }}
      >
        {barWidgets.map((w) => (
          <BarButton
            key={w.id}
            widget={w}
            active={w.id === active.id}
            onClick={() => activate(w.id)}
          />
        ))}
        {overflowing && (
          <UnstyledButton
            onClick={() => setMenuOpen(true)}
            aria-label="All widgets"
            style={{ flex: 1, height: "100%" }}
          >
            <Stack align="center" justify="center" gap={2} h="100%">
              <IconMenu2 size={22} stroke={1.5} />
              <Text fz={10} c="dimmed">
                More
              </Text>
            </Stack>
          </UnstyledButton>
        )}
      </Group>
      <Drawer
        opened={menuOpen}
        onClose={() => setMenuOpen(false)}
        position="bottom"
        title="Widgets"
        size="60%"
      >
        <Stack gap={4}>
          {widgets.map((w) => {
            const descriptor = getWidget(w.type);
            if (!descriptor) return null;
            const Icon = descriptor.Icon;
            const isActive = w.id === active.id;
            return (
              <UnstyledButton
                key={w.id}
                onClick={() => activate(w.id)}
                p="sm"
                style={{
                  borderRadius: "var(--mantine-radius-md)",
                  background: isActive ? "var(--mantine-color-dark-6)" : undefined,
                }}
              >
                <Group gap="sm">
                  {Icon && (
                    <ActionIcon
                      component="span"
                      variant="subtle"
                      color={isActive ? "accent" : "gray"}
                    >
                      <Icon size={20} stroke={1.5} />
                    </ActionIcon>
                  )}
                  <Text fw={isActive ? 600 : 400}>{widgetLabel(w, descriptor)}</Text>
                </Group>
              </UnstyledButton>
            );
          })}
        </Stack>
      </Drawer>
    </Box>
  );
};

const BarButton = ({
  widget,
  active,
  onClick,
}: {
  widget: Widget;
  active: boolean;
  onClick: () => void;
}) => {
  const descriptor = getWidget(widget.type);
  if (!descriptor) return null;
  const Icon = descriptor.Icon;
  const label = widgetLabel(widget, descriptor);
  return (
    <UnstyledButton
      onClick={onClick}
      aria-label={label}
      aria-current={active || undefined}
      c={active ? "accent.4" : "dimmed"}
      style={{ flex: 1, height: "100%", minWidth: 0 }}
    >
      <Stack align="center" justify="center" gap={2} h="100%" px={4}>
        {Icon && <Icon size={22} stroke={1.5} />}
        <Text
          fz={10}
          maw="100%"
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {label}
        </Text>
      </Stack>
    </UnstyledButton>
  );
};
