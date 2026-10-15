import { ActionIcon, CloseButton, Group, Menu, Stack, Text } from "@mantine/core";
import { IconCheck, IconDots } from "@tabler/icons-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { createPortal } from "react-dom";

const ActionsSlot = createContext<HTMLElement | null>(null);

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
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>{children}</div>
      </ActionsSlot>
    </Stack>
  );
};

/** Puts a drawer's actions in its panel header, beside the close button. */
export const PanelActions = ({ children }: { children: ReactNode }) => {
  const slot = useContext(ActionsSlot);
  return slot ? createPortal(children, slot) : null;
};

/** A drawer's few display options, under ⋯ in its header; what's listed belongs in its search. */
export const ViewMenu = ({ children }: { children: ReactNode }) => (
  <Menu position="bottom-end" withinPortal>
    <Menu.Target>
      <ActionIcon variant="subtle" color="gray" aria-label="View options" title="View options">
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
