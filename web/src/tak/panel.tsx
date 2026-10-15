import { ActionIcon, CloseButton, Group, Menu, Stack, Switch, Text } from "@mantine/core";
import { IconCheck, IconDots } from "@tabler/icons-react";
import { createContext, type ReactNode, useContext, useId, useState } from "react";
import { createPortal } from "react-dom";

const ActionsSlot = createContext<HTMLElement | null>(null);
const FooterSlot = createContext<HTMLElement | null>(null);

/** A drawer's frame: title, the drawer's own actions on the right, then its content. */
export const Panel = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  return (
    <Stack gap="sm" h="100%">
      <Group justify="space-between" wrap="nowrap" gap="xs" className="tak-panel-header">
        <Text component="h2" className="tak-panel-title">
          {title}
        </Text>
        <Group gap={4} wrap="nowrap">
          <Group gap={4} wrap="nowrap" ref={setSlot} />
          <CloseButton size="sm" onClick={onClose} aria-label={`Close ${title}`} />
        </Group>
      </Group>
      <ActionsSlot value={slot}>
        <FooterSlot value={footer}>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
        </FooterSlot>
      </ActionsSlot>
      <Group gap="xs" className="tak-panel-footer" ref={setFooter} />
    </Stack>
  );
};

/** Puts a drawer's actions in its panel header, beside the close button. */
export const PanelActions = ({ children }: { children: ReactNode }) => {
  const slot = useContext(ActionsSlot);
  return slot ? createPortal(children, slot) : null;
};

/** Puts a drawer's main actions at its foot, below what scrolls. */
export const PanelFooter = ({ children }: { children: ReactNode }) => {
  const slot = useContext(FooterSlot);
  return slot ? createPortal(children, slot) : null;
};

/**
 * A drawer's ⋯ menu, its header's only control besides close: secondary actions,
 * then its few display options. The main action sits at the drawer's foot.
 */
export const PanelMenu = ({ children }: { children: ReactNode }) => (
  <Menu position="bottom-end" withinPortal>
    <Menu.Target>
      <ActionIcon variant="subtle" color="gray" aria-label="More options" title="More options">
        <IconDots size={16} />
      </ActionIcon>
    </Menu.Target>
    <Menu.Dropdown>{children}</Menu.Dropdown>
  </Menu>
);

/** An on/off view option, ticked while on. */
export const ViewOption = ({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) => (
  <Menu.Item
    role="menuitemcheckbox"
    aria-checked={checked}
    rightSection={checked ? <IconCheck size={14} /> : undefined}
    onClick={() => onChange(!checked)}
  >
    {children}
  </Menu.Item>
);

/** A drawer row: its name on the left, then `children`, then a switch. The hint shows on hover. */
export const ToggleRow = ({
  label,
  hint,
  warning,
  checked,
  disabled,
  onChange,
  children,
}: {
  label: ReactNode;
  hint?: string;
  warning?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children?: ReactNode;
}) => {
  const id = useId();
  return (
    <Group className="tak-row" gap={6} wrap="nowrap" title={hint}>
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text component="label" htmlFor={id} fz="sm" truncate style={{ cursor: "pointer" }}>
          {label}
        </Text>
        {warning && (
          <Text fz="xs" c="warning.4">
            {warning}
          </Text>
        )}
      </Stack>
      {children}
      <Switch id={id} size="xs" checked={checked} disabled={disabled} onChange={onChange} />
    </Group>
  );
};

/** A drawer row: its name on the left and its control on the right. */
export const SettingRow = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) => (
  <Group className="tak-row" gap={6} wrap="nowrap" title={hint}>
    <Text fz="sm" truncate style={{ flex: 1, minWidth: 0 }}>
      {label}
    </Text>
    {children}
  </Group>
);

const DRAWER_MIN = 260;
const DRAWER_MAX = 640;
export const DRAWER_WIDTH = 320;
const KEY_STEP = 16;

const clampWidth = (w: number) => Math.round(Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, w)));

/**
 * The drag handle on a drawer's edge. Dragging sets the width on the drawer
 * itself and saves it on release, so the workspace doesn't re-render per move.
 */
export const ResizeHandle = ({
  width,
  onWidth,
}: {
  width: number;
  onWidth: (width: number) => void;
}) => {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const drawer = e.currentTarget.parentElement;
    if (!drawer) return;
    e.preventDefault();
    const startX = e.clientX;
    let next = width;
    const onMove = (m: PointerEvent) => {
      next = clampWidth(width + m.clientX - startX);
      drawer.style.setProperty("--tak-drawer-width", `${next}px`);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      onWidth(next);
    };
    // The whole page, so the drag keeps going when the pointer outruns the thin handle.
    document.body.style.cursor = "col-resize";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA pattern for a resize handle.
    <div
      className="tak-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Drawer width"
      aria-valuenow={width}
      aria-valuemin={DRAWER_MIN}
      aria-valuemax={DRAWER_MAX}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onWidth(DRAWER_WIDTH)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" ? KEY_STEP : e.key === "ArrowLeft" ? -KEY_STEP : 0;
        if (!step) return;
        e.preventDefault();
        onWidth(clampWidth(width + step));
      }}
    />
  );
};
