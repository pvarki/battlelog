import { ActionIcon, Box, Group, Loader, Menu, Paper, Stack, Text } from "@mantine/core";
import { IconDots } from "@tabler/icons-react";
import { Component, type ReactNode, Suspense, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Widget } from "../api.ts";
import { Placeholder } from "../Placeholder.tsx";
import { formatDateTime } from "../time.ts";
import { getWidget, validateWidgetConfig } from "./registry.ts";
import { configTitle } from "./widget-base.ts";

const noop = () => {};

// Callbacks are optional so read-only hosts can omit the edit-menu ones — but
// onConfigure and onUpdateConfig fire OUTSIDE edit mode too (empty-config CTAs;
// useEventDocument persisting a captured eventId). A host that renders live
// widgets must pass those two or edits can be silently dropped.
type Props = {
  instance: Widget;
  editMode: boolean;
  dashboardIsTemplate?: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
  onResetSize?: () => void;
  onResetConfig?: () => void;
  onUpdateConfig?: (config: unknown) => void;
  /** Just added to the canvas: plays the entrance animation once. */
  entering?: boolean;
};

class WidgetErrorBoundary extends Component<
  { children: ReactNode; type: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <Placeholder
          title="Widget crashed"
          detail={`${this.props.type}: ${this.state.error.message}`}
          action={{ label: "Retry", onClick: () => this.setState({ error: null }) }}
        />
      );
    }
    return this.props.children;
  }
}

/**
 * Owns all widget chrome (header, menu, failure placeholders) — Views get no
 * "delete me" callbacks. Each widget is its own error boundary, so one crash
 * never takes the dashboard down; Views are lazy, so Suspense covers loading.
 */
export const WidgetWrapper = ({
  instance,
  editMode,
  dashboardIsTemplate,
  onConfigure = noop,
  onRemove = noop,
  onDuplicate = noop,
  onResetSize = noop,
  onResetConfig = noop,
  onUpdateConfig = noop,
  entering,
}: Props) => {
  const descriptor = getWidget(instance.type);

  // Convention: a `title` string in any widget's config renders bold in the
  // header under the type caption (per the design mock).
  const title = configTitle(instance.config);

  const typeName = descriptor?.name ?? instance.type;
  const paperRef = useRef<HTMLDivElement>(null);
  const [printHeader, setPrintHeader] = useState({ at: "", kicker: "", title: "" });
  const [printScope, setPrintScope] = useState<PrintScope>({ activeChildId: null, pending: false });
  const readPrintScope = (): PrintScope => {
    const paper = paperRef.current;
    const activeChild = paper?.querySelector("[data-active-child]");
    return {
      activeChildId: activeChild?.getAttribute("data-active-child") ?? null,
      pending: !!(activeChild ?? paper)?.querySelector("[data-print-pending]"),
    };
  };
  /** Prints this widget; with `child`, titled as that child (a container shows only it). */
  const print = (child?: PrintableChild) => {
    const paper = paperRef.current;
    // Re-read: the tab on show or its loading state can change while the menu is open.
    const scope = readPrintScope();
    if (!paper || scope.pending || (child && child.id !== scope.activeChildId)) return;
    // Synchronous so the header is in the DOM before the print snapshot.
    flushSync(() =>
      setPrintHeader({
        at: formatDateTime(new Date().toISOString()),
        kicker: child?.typeName ?? typeName,
        title: child?.label ?? (title || typeName),
      }),
    );
    paper.classList.add("print-target");
    window.addEventListener("afterprint", () => paper.classList.remove("print-target"), {
      once: true,
    });
    window.print();
  };

  return (
    <Paper
      ref={paperRef}
      withBorder
      h="100%"
      className={entering ? "widget-enter" : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        // Edit mode must be visible from across the room: every widget
        // switches to a dashed accent border while the canvas is editable.
        ...(editMode && {
          borderStyle: "dashed",
          borderColor: "var(--mantine-color-accent-7)",
        }),
      }}
    >
      <div className="print-only print-doc-header">
        <div className="print-doc-kicker">
          <span>BattleLog</span>
          <span>{printHeader.kicker}</span>
        </div>
        <div className="print-doc-title">{printHeader.title}</div>
        <div className="print-doc-meta">Printed {printHeader.at}</div>
      </div>
      <Group
        className="widget-drag-handle screen-only"
        justify="space-between"
        px="xs"
        py={4}
        style={{
          cursor: editMode ? "grab" : "default",
          borderBottom: "1px solid var(--mantine-color-dark-4)",
        }}
      >
        <div>
          <Text fz="xs" c="dimmed">
            {typeName}
          </Text>
          {title && (
            <Text fw={600} fz="sm" lh={1.2}>
              {title}
            </Text>
          )}
        </div>
        {editMode && (
          <Menu position="bottom-end" onOpen={() => setPrintScope(readPrintScope())}>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Widget menu">
                <IconDots size={16} stroke={1.5} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {descriptor?.ConfigForm && <Menu.Item onClick={onConfigure}>Settings</Menu.Item>}
              <Menu.Item onClick={onDuplicate}>Duplicate</Menu.Item>
              <PrintItems instance={instance} scope={printScope} onPrint={print} />
              <Menu.Item onClick={onResetSize} disabled={!descriptor}>
                Reset size
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={onRemove}>
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      <Box flex={1} mih={0}>
        <WidgetBody
          instance={instance}
          editMode={editMode}
          dashboardIsTemplate={dashboardIsTemplate}
          onConfigure={onConfigure}
          onRemove={onRemove}
          onResetConfig={onResetConfig}
          onUpdateConfig={onUpdateConfig}
        />
      </Box>
    </Paper>
  );
};

type PrintableChild = { id: string; label: string; typeName: string };

/**
 * What the menu can print, read from the DOM when it opens: the child a
 * container has on show, and whether a document-backed print layout
 * (`data-print-pending`) is still loading — that would print empty.
 */
type PrintScope = { activeChildId: string | null; pending: boolean };

const printableChild = (
  instance: Pick<Widget, "type" | "config">,
  activeChildId: string | null,
): PrintableChild | undefined => {
  const childWidgets = getWidget(instance.type)?.childWidgets;
  if (!childWidgets || !activeChildId) return undefined;
  const validation = validateWidgetConfig(instance.type, instance.config);
  if (!validation.ok) return undefined;
  const child = childWidgets(validation.value).find((c) => c.id === activeChildId);
  const descriptor = child && getWidget(child.type);
  if (!child || !descriptor?.printable) return undefined;
  return {
    id: child.id,
    label: configTitle(child.config) ?? descriptor.name,
    typeName: descriptor.name,
  };
};

/** Rendered only while the menu is open, so the config validation stays off the render path. */
const PrintItems = ({
  instance,
  scope,
  onPrint,
}: {
  instance: Pick<Widget, "type" | "config">;
  scope: PrintScope;
  onPrint: (child?: PrintableChild) => void;
}) => {
  const printable = getWidget(instance.type)?.printable;
  const child = printable ? undefined : printableChild(instance, scope.activeChildId);
  if (!printable && !child) return null;
  const label = child ? `Print “${child.label}”` : "Print";
  return (
    <Menu.Item disabled={scope.pending} onClick={() => onPrint(child)}>
      {scope.pending ? `${label} — loading…` : label}
    </Menu.Item>
  );
};

type BodyProps = {
  instance: Pick<Widget, "id" | "type" | "config">;
  editMode: boolean;
  dashboardIsTemplate?: boolean;
  onConfigure: () => void;
  onRemove: () => void;
  onResetConfig: () => void;
  onUpdateConfig: (config: unknown) => void;
};

/** A widget's content without chrome — for hosts, like tabs, that draw their own header. */
export const WidgetBody = ({
  instance,
  editMode,
  dashboardIsTemplate,
  onConfigure,
  onRemove,
  onResetConfig,
  onUpdateConfig,
}: BodyProps) => {
  const descriptor = getWidget(instance.type);
  const validation = useMemo(
    () => validateWidgetConfig(instance.type, instance.config),
    [instance.type, instance.config],
  );
  if (!descriptor) {
    return (
      <Placeholder
        title="Unknown widget"
        detail={`No widget of type "${instance.type}" is registered`}
        action={editMode ? { label: "Remove", onClick: onRemove } : undefined}
      />
    );
  }
  if (!validation.ok) {
    return (
      <Placeholder
        title="Invalid configuration"
        detail={validation.details ?? "Stored config does not match the widget's schema"}
        action={editMode ? { label: "Reset to defaults", onClick: onResetConfig } : undefined}
      />
    );
  }
  return (
    <WidgetErrorBoundary type={instance.type}>
      <Suspense
        fallback={
          <Stack align="center" justify="center" h="100%" data-print-pending>
            <Loader size="sm" />
          </Stack>
        }
      >
        <descriptor.View
          config={validation.value}
          instanceId={instance.id}
          editMode={editMode}
          dashboardIsTemplate={dashboardIsTemplate}
          updateConfig={onUpdateConfig}
          onConfigure={onConfigure}
        />
      </Suspense>
    </WidgetErrorBoundary>
  );
};
