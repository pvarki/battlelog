import { Button, Group, Switch, Table, Text, Tooltip } from "@mantine/core";
import type { Position } from "../cot.ts";
import { area, formatDistance } from "../geo.ts";
import { type Cursor, useCursor } from "../map/cursor.ts";
import { formatArea, formatBearing, legsOf, perimeter, totalDistance } from "./measure.ts";

type Props = {
  points: Position[];
  /** Measuring the area the points enclose instead of the distance along them. */
  closed: boolean;
  onClosedChange: (closed: boolean) => void;
  cursor: Cursor;
  onClear: () => void;
  /** Publishes the measurement as an ATAK range-and-bearing line; needs exactly two points. */
  onSave: () => void;
  /** Why saving is unavailable, or undefined when it is. */
  saveDisabledReason: string | undefined;
};

/** Each leg's distance and bearing, the total or the enclosed area, and the leg to the cursor. */
export const MeasurePanel = ({
  points,
  closed,
  onClosedChange,
  cursor: pointer,
  onClear,
  onSave,
  saveDisabledReason,
}: Props) => {
  const cursor = useCursor(pointer);
  const legs = legsOf(points);
  const [next] = cursor && points.length ? legsOf([points.at(-1) as Position, cursor]) : [];
  const saveReason =
    saveDisabledReason ??
    (points.length === 2 ? undefined : "A range-and-bearing line has two points");

  const areaSwitch = (
    <Switch
      size="xs"
      label="Area"
      checked={closed}
      onChange={(e) => onClosedChange(e.currentTarget.checked)}
    />
  );

  if (points.length === 0)
    return (
      <Group gap={4} justify="space-between" wrap="nowrap" px={6} pt={2}>
        <Text fz="xs" c="dimmed">
          {closed
            ? "Click the corners of an area to measure it."
            : "Click points on the map to measure distance and bearing."}
        </Text>
        {areaSwitch}
      </Group>
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
          {!closed && legs.length > 1 && (
            <Table.Tr fw={600}>
              <Table.Td>Σ</Table.Td>
              <Table.Td colSpan={2}>{formatDistance(totalDistance(legs))}</Table.Td>
            </Table.Tr>
          )}
          {closed && points.length >= 3 && (
            <>
              <Table.Tr fw={600}>
                <Table.Td>Area</Table.Td>
                <Table.Td colSpan={2}>{formatArea(area(points))}</Table.Td>
              </Table.Tr>
              <Table.Tr fw={600}>
                <Table.Td>Perimeter</Table.Td>
                <Table.Td colSpan={2}>{formatDistance(perimeter(points))}</Table.Td>
              </Table.Tr>
            </>
          )}
        </Table.Tbody>
      </Table>
      <Group gap={4} justify="flex-end" pt={4}>
        {areaSwitch}
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
