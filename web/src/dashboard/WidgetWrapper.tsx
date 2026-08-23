import { ActionIcon, Box, Group, Loader, Menu, Paper, Stack, Text } from "@mantine/core";
import { IconDots } from "@tabler/icons-react";
import { Component, type ReactNode, Suspense, useMemo } from "react";
import type { Widget } from "../api.ts";
import { Placeholder } from "../Placeholder.tsx";
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
  onConfigure = noop,
  onRemove = noop,
  onDuplicate = noop,
  onResetSize = noop,
  onResetConfig = noop,
  onUpdateConfig = noop,
  entering,
}: Props) => {
  const descriptor = getWidget(instance.type);
  const validation = useMemo(
    () => validateWidgetConfig(instance.type, instance.config),
    [instance.type, instance.config],
  );

  // Convention: a `title` string in any widget's config renders bold in the
  // header under the type caption (per the design mock).
  const title = configTitle(instance.config);

  return (
    <Paper
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
      <Group
        className="widget-drag-handle"
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
            {descriptor?.name ?? instance.type}
          </Text>
          {title && (
            <Text fw={600} fz="sm" lh={1.2}>
              {title}
            </Text>
          )}
        </div>
        {editMode && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Widget menu">
                <IconDots size={16} stroke={1.5} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {descriptor?.ConfigForm && <Menu.Item onClick={onConfigure}>Settings</Menu.Item>}
              <Menu.Item onClick={onDuplicate}>Duplicate</Menu.Item>
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
        {!descriptor ? (
          <Placeholder
            title="Unknown widget"
            detail={`No widget of type "${instance.type}" is registered`}
            action={editMode ? { label: "Remove", onClick: onRemove } : undefined}
          />
        ) : !validation.ok ? (
          <Placeholder
            title="Invalid configuration"
            detail={validation.details ?? "Stored config does not match the widget's schema"}
            action={editMode ? { label: "Reset to defaults", onClick: onResetConfig } : undefined}
          />
        ) : (
          <WidgetErrorBoundary type={instance.type}>
            <Suspense
              fallback={
                <Stack align="center" justify="center" h="100%">
                  <Loader size="sm" />
                </Stack>
              }
            >
              <descriptor.View
                config={validation.value}
                instanceId={instance.id}
                editMode={editMode}
                updateConfig={onUpdateConfig}
                onConfigure={onConfigure}
              />
            </Suspense>
          </WidgetErrorBoundary>
        )}
      </Box>
    </Paper>
  );
};
