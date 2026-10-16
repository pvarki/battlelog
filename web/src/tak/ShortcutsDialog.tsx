import { Button, Group, Kbd, Modal, Stack, Table } from "@mantine/core";
import { SectionHeading } from "../components/SectionHeading.tsx";
import { ACTION_GROUPS, ACTIONS, formatBinding } from "./keys/bindings.ts";
import { useKeymap } from "./keys/useKeymap.ts";

type Props = {
  opened: boolean;
  onClose: () => void;
  /** Opens where the shortcuts are changed. */
  onEdit: () => void;
};

const FIXED: [keys: string, what: string][] = [
  ["Esc", "Stop drawing, close the selection, then the drawer"],
  ["Tab", "In search: an item's or plan's own actions"],
  ["Shift-click", "Add an item to the selection, or take it out"],
  ["Shift-drag", "Select everything in a box"],
  ["Right-click a point", "Remove it while editing a line, route or area"],
];

const Row = ({ keys, what }: { keys: string[]; what: string }) => (
  <Table.Tr>
    <Table.Td w={150}>
      <Group gap={4}>
        {keys.map((k) => (
          <Kbd key={k} size="xs">
            {k}
          </Kbd>
        ))}
      </Group>
    </Table.Td>
    <Table.Td>{what}</Table.Td>
  </Table.Tr>
);

/** Every keyboard shortcut and mouse gesture of the map in one place. */
export const ShortcutsDialog = ({ opened, onClose, onEdit }: Props) => {
  const { keymap } = useKeymap();
  return (
    <Modal opened={opened} onClose={onClose} title="Keyboard and mouse" size="md">
      <Stack gap="md">
        {ACTION_GROUPS.map((group) => (
          <Stack key={group} gap={4}>
            <SectionHeading>{group}</SectionHeading>
            <Table verticalSpacing={4} fz="sm">
              <Table.Tbody>
                {ACTIONS.filter((a) => a.group === group && keymap.get(a.id)?.length).map((a) => (
                  <Row
                    key={a.id}
                    keys={(keymap.get(a.id) ?? []).map((k) => formatBinding(k))}
                    what={group === "Drawers" ? `Open or close ${a.label}` : a.label}
                  />
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        ))}
        <Stack gap={4}>
          <SectionHeading>Always</SectionHeading>
          <Table verticalSpacing={4} fz="sm">
            <Table.Tbody>
              {FIXED.map(([keys, what]) => (
                <Row key={keys} keys={[keys]} what={what} />
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
        <Group>
          <Button size="xs" variant="default" onClick={onEdit}>
            Change shortcuts
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
