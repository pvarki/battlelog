import { ActionIcon, Box, Button, Group, Loader, Menu, Paper, Stack, Text } from "@mantine/core";
import { Component, type ReactNode, Suspense, useMemo } from "react";
import type { Widget } from "../api.ts";
import { getWidget, validateWidgetConfig } from "./registry.ts";

type Props = {
  instance: Widget;
  editMode: boolean;
  onRemove: () => void;
  onDuplicate: () => void;
  onResetSize: () => void;
  onResetConfig: () => void;
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

const Placeholder = ({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { label: string; onClick: () => void };
}) => (
  <Stack align="center" justify="center" h="100%" gap={6} p="sm" ta="center">
    <Text fw={600}>{title}</Text>
    <Text c="dimmed" fz="xs">
      {detail}
    </Text>
    {action && (
      <Button size="compact-xs" variant="light" onClick={action.onClick}>
        {action.label}
      </Button>
    )}
  </Stack>
);

/**
 * Owns all widget chrome (header, menu, failure placeholders) — Views get no
 * "delete me" callbacks. Each widget is its own error boundary, so one crash
 * never takes the dashboard down; Views are lazy, so Suspense covers loading.
 */
export const WidgetWrapper = ({
  instance,
  editMode,
  onRemove,
  onDuplicate,
  onResetSize,
  onResetConfig,
}: Props) => {
  const descriptor = getWidget(instance.type);
  const validation = useMemo(
    () => validateWidgetConfig(instance.type, instance.config),
    [instance.type, instance.config],
  );

  return (
    <Paper withBorder h="100%" style={{ display: "flex", flexDirection: "column" }}>
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
        <Text fz="xs" c="dimmed">
          {descriptor?.name ?? instance.type}
        </Text>
        {editMode && (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Widget menu">
                …
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
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
              />
            </Suspense>
          </WidgetErrorBoundary>
        )}
      </Box>
    </Paper>
  );
};
