import { Box, Drawer, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconMenu2 } from "@tabler/icons-react";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { DashboardResponse, Widget } from "../api.ts";
import { dashboardsApi } from "../api.ts";
import { Placeholder } from "../Placeholder.tsx";
import { mobileWidgets } from "./mobile.ts";
import { getWidget, type WidgetDescriptor } from "./registry.ts";
import { WidgetWrapper } from "./WidgetWrapper.tsx";
import { configTitle } from "./widget-base.ts";

const BAR_HEIGHT = 64;
const MAX_BAR_BUTTONS = 5;

const lastViewedKey = (dashboardId: string) => `battlelog.mobile.active.${dashboardId}`;

const widgetLabel = (w: Widget, descriptor: WidgetDescriptor) =>
  configTitle(w.config) ?? descriptor.name;

/**
 * Phone rendering of a dashboard: one widget fullscreen at a time, a bottom
 * bar to switch. No edit mode and no layout changes — but widget Views still
 * write config outside edit mode (useEventDocument captures the eventId on an
 * event-backed widget's first edit; dropping that write would orphan the
 * widget's chain), so config changes are persisted here too.
 */
export const MobileSwitcher = ({ dashboard }: { dashboard: DashboardResponse }) => {
  const router = useRouter();
  const [allWidgets, setAllWidgets] = useState(dashboard.widgets);
  const widgets = mobileWidgets(allWidgets);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(lastViewedKey(dashboard.id));
    } catch {
      return null;
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);

  const widgetsRef = useRef(dashboard.widgets);
  const version = useRef(dashboard.version);
  const chain = useRef(Promise.resolve());

  // Serialized saves, always sending the latest widgets against the latest
  // version. A 409 means the board changed on a desktop — reload it (the
  // page keys this component by version, so state remounts fresh).
  const queueSave = () => {
    chain.current = chain.current.then(async () => {
      try {
        const res = await dashboardsApi.dashboards[":dashboardId"].$patch({
          param: { dashboardId: dashboard.id },
          json: { version: version.current, widgets: widgetsRef.current },
        });
        if (res.status === 200) version.current = (await res.json()).version;
        else if (res.status === 409) router.invalidate();
        else setTimeout(queueSave, 3000);
      } catch {
        // Network blip: the eventId must not be lost — retry until it lands.
        setTimeout(queueSave, 3000);
      }
    });
  };

  const updateConfig = (id: string, config: unknown) => {
    widgetsRef.current = widgetsRef.current.map((w) => (w.id === id ? { ...w, config } : w));
    setAllWidgets(widgetsRef.current);
    queueSave();
  };

  // Views render "configure me" CTAs for empty configs; there is no config UI
  // on mobile, so at least say where it lives instead of a dead button.
  const explainConfigure = () =>
    notifications.show({ message: "Widgets are configured on a desktop screen." });

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
  // The active widget may live behind the More button — it still needs an
  // active indicator somewhere in the bar.
  const activeInOverflow = overflowing && !barWidgets.some((w) => w.id === active.id);

  return (
    <Box h="calc(100dvh - 48px)" style={{ display: "flex", flexDirection: "column" }}>
      <Box flex={1} mih={0} p="xs">
        <WidgetWrapper
          key={active.id}
          instance={active}
          editMode={false}
          onConfigure={explainConfigure}
          onUpdateConfig={(config) => updateConfig(active.id, config)}
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
            aria-current={activeInOverflow || undefined}
            c={activeInOverflow ? "accent.4" : "dimmed"}
            style={{ flex: 1, height: "100%" }}
          >
            <Stack align="center" justify="center" gap={2} h="100%">
              <IconMenu2 size={22} stroke={1.5} />
              <Text fz={10}>More</Text>
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
                <Group gap="sm" c={isActive ? "accent.4" : undefined}>
                  {Icon && <Icon size={20} stroke={1.5} />}
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
