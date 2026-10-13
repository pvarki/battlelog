import { Badge, Button, Group, Paper, Text, Tooltip } from "@mantine/core";
import {
  IconCircle,
  IconLine,
  IconMapPin,
  IconPolygon,
  IconRectangle,
  IconRuler2,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { TOOLS, type Tool } from "./useDrawing.ts";

const ICONS = {
  marker: IconMapPin,
  line: IconLine,
  polygon: IconPolygon,
  rectangle: IconRectangle,
  circle: IconCircle,
} as const;

const HINT: Record<Tool, string> = {
  marker: "Click where the marker goes.",
  line: "Click to add points; click the last point again to finish.",
  polygon: "Click to add corners; click the first corner to close.",
  rectangle: "Click one corner, then the opposite corner.",
  circle: "Click the centre, then click again at the edge.",
};

type Props = {
  tool: Tool | undefined;
  onChoose: (tool: Tool | undefined) => void;
  /** Why drawing is unavailable, or undefined when it is. */
  disabledReason: string | undefined;
  /** The plan new items go into; undefined = Live, straight to TAK. */
  planName: string | undefined;
  measuring: boolean;
  onToggleMeasure: () => void;
  /** The measurement readout, shown while measuring. */
  children?: ReactNode;
};

/** Drawing tools over the map; the active tool shows how to use it. */
export const DrawToolbar = ({
  tool,
  onChoose,
  disabledReason,
  planName,
  measuring,
  onToggleMeasure,
  children,
}: Props) => (
  <Paper className="tak-draw-toolbar" shadow="sm" p={4} withBorder>
    <Group gap={4} wrap="nowrap">
      <Badge
        size="sm"
        variant={planName ? "filled" : "outline"}
        color={planName ? "primary" : "gray"}
        title={
          planName
            ? "Drawings and edits go into this plan"
            : "Drawings and edits go straight to TAK"
        }
      >
        {planName ? `Plan: ${planName}` : "Live"}
      </Badge>
      {(Object.keys(TOOLS) as Tool[]).map((id) => {
        const Icon = ICONS[id];
        return (
          <Tooltip key={id} label={disabledReason} disabled={!disabledReason} withArrow>
            <Button
              size="compact-xs"
              variant={tool === id ? "filled" : "subtle"}
              color={tool === id ? "primary" : "gray"}
              leftSection={<Icon size={14} />}
              aria-pressed={tool === id}
              disabled={!!disabledReason}
              onClick={() => onChoose(tool === id ? undefined : id)}
            >
              {TOOLS[id].label}
            </Button>
          </Tooltip>
        );
      })}
      <Button
        size="compact-xs"
        variant={measuring ? "filled" : "subtle"}
        color={measuring ? "primary" : "gray"}
        leftSection={<IconRuler2 size={14} />}
        aria-pressed={measuring}
        onClick={onToggleMeasure}
      >
        Measure
      </Button>
      {(tool || measuring) && (
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          leftSection={<IconX size={14} />}
          onClick={() => (measuring ? onToggleMeasure() : onChoose(undefined))}
        >
          Stop (Esc)
        </Button>
      )}
    </Group>
    {tool && (
      <Text fz="xs" c="dimmed" px={6} pt={2}>
        {HINT[tool]}
      </Text>
    )}
    {measuring && children}
  </Paper>
);
