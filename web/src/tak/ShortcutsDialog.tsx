import { Kbd, Modal, Table } from "@mantine/core";

type Props = {
  opened: boolean;
  onClose: () => void;
  /** The drawers this map has, with the key that opens each. */
  drawers: { label: string; key: string }[];
};

const GENERAL: [keys: string, what: string][] = [
  ["/ or Ctrl/⌘ K", "Search items, places and commands; Tab for an item's actions"],
  ["C", "Centre the map on the selected item"],
  ["L", "Laser pointer: point things out; hold the button to draw strokes that fade"],
  ["Esc", "Stop drawing, close the selection, then the drawer"],
  ["Ctrl/⌘ Z", "Undo the latest change"],
  ["Shift-click", "Add an item to the selection, or take it out"],
  ["Shift-drag", "Select everything in a box"],
  ["Right-click a point", "Remove it while editing a line, route or area"],
  ["?", "This list"],
];

/** Every keyboard shortcut and mouse gesture of the map in one place. */
export const ShortcutsDialog = ({ opened, onClose, drawers }: Props) => (
  <Modal opened={opened} onClose={onClose} title="Keyboard and mouse" size="md">
    <Table verticalSpacing={4} fz="sm">
      <Table.Tbody>
        {[
          ...drawers.map((d): [string, string] => [d.key, `Open or close ${d.label}`]),
          ...GENERAL,
        ].map(([keys, what]) => (
          <Table.Tr key={keys}>
            <Table.Td w={150}>
              <Kbd size="xs">{keys}</Kbd>
            </Table.Td>
            <Table.Td>{what}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  </Modal>
);
