import { Button, Group, Table, Text, Tooltip } from "@mantine/core";
import type { Position } from "../cot.ts";
import { formatDistance } from "../map/layers.ts";
import { formatBearing, legsOf, totalDistance } from "./measure.ts";

type Props = {
  points: Position[];
  cursor: Position | undefined;
  onClear: () => void;
  /** Publishes the measurement as an ATAK range-and-bearing line; needs exactly two points. */
  onSave: () => void;
  /** Why saving is unavailable, or undefined when it is. */
  saveDisabledReason: string | undefined;
};

/** Each leg's distance and bearing, the total, and the leg to the cursor. */
export const MeasurePanel = ({ points, cursor, onClear, onSave, saveDisabledReason }: Props) => {
  const legs = legsOf(points);
  const [next] = cursor && points.length ? legsOf([points.at(-1) as Position, cursor]) : [];
  const saveReason =
    saveDisabledReason ??
    (points.length === 2 ? undefined : "A range-and-bearing line has two points");

  if (points.length === 0)
    return (
      <Text fz="xs" c="dimmed" px={6} pt={2}>
        Click points on the map to measure distance and bearing.
      </Text>
    );

  return (
    <div>
      <Table fz="xs" className="tak-mono" verticalSpacing={2} horizontalSpacing={6}>
        <Table.Tbody>
          {legs.map((leg, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: legs are positional and only appended.
            <Table.Tr key={i}>
              <Table.Td>{i + 1}</Table.Td>
              <Table.Td>{formatDistance(leg.distance)}</Table.Td>
              <Table.Td>{formatBearing(leg.bearing)}</Table.Td>
            </Table.Tr>
          ))}
          {next && (
            <Table.Tr c="dimmed">
              <Table.Td>→</Table.Td>
              <Table.Td>{formatDistance(next.distance)}</Table.Td>
              <Table.Td>{formatBearing(next.bearing)}</Table.Td>
            </Table.Tr>
          )}
          {legs.length > 1 && (
            <Table.Tr fw={600}>
              <Table.Td>Σ</Table.Td>
              <Table.Td colSpan={2}>{formatDistance(totalDistance(legs))}</Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      <Group gap={4} justify="flex-end" pt={4}>
        <Button size="compact-xs" variant="subtle" color="gray" onClick={onClear}>
          Clear
        </Button>
        <Tooltip label={saveReason} disabled={!saveReason} withArrow>
          <Button size="compact-xs" variant="light" disabled={!!saveReason} onClick={onSave}>
            Save as R&amp;B line
          </Button>
        </Tooltip>
      </Group>
    </div>
  );
};
