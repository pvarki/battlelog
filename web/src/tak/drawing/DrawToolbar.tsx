import { Badge, Button, Group, Menu, Paper, Text, Tooltip } from "@mantine/core";
import {
  IconArrowBackUp,
  IconChevronDown,
  IconCircle,
  IconCircles,
  IconLasso,
  IconLine,
  IconMapPin,
  IconPolygon,
  IconRectangle,
  IconRoute,
  IconRuler2,
  IconTarget,
  IconTools,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { SymbolPickerButton } from "./SymbolPicker.tsx";
import type { SymbolChoice } from "./symbol-catalogue.ts";
import { TacticalGraphicPicker } from "./TacticalGraphicPicker.tsx";
import { hintFor, type TacticalGraphic } from "./tactical-graphics.ts";
import { TOOLS, type Tool } from "./useDrawing.ts";

const ICONS = {
  marker: IconMapPin,
  line: IconLine,
  polygon: IconPolygon,
  rectangle: IconRectangle,
  circle: IconCircle,
  route: IconRoute,
  rings: IconCircles,
  bullseye: IconTarget,
} as const;

/** Under the Tools menu with Measure, so the toolbar stays short. */
const MENU_TOOLS = ["rings", "bullseye"] as const satisfies Tool[];
const isMenuTool = (tool: Tool | undefined) => MENU_TOOLS.some((id) => id === tool);
const DRAW_TOOLS = (Object.keys(TOOLS) as Tool[]).filter((id) => !isMenuTool(id));

const HINT: Record<Tool, string> = {
  marker: "Click where the marker goes.",
  line: "Click to add points; click the last point again to finish, or the first to close the line.",
  polygon: "Click to add corners; click the first corner to close.",
  rectangle: "Click one corner, then the opposite corner.",
  circle: "Click the centre, then click again at the edge.",
  route:
    "Click each checkpoint in order; click the last one again to finish, or the first to make a loop.",
  rings: "Click the centre of the range rings.",
  bullseye: "Click the centre of the bullseye.",
};

const LASSO_HINT =
  "Draw around the items to select, with the mouse or a finger; each outline adds to the selection.";

const SYMBOL_HINT = "Click where the symbol goes.";

const EDIT_HINT =
  "Drag the item or its points. On a line, route or area, drag a midpoint to add a point and right-click a point to remove it.";

type Props = {
  tool: Tool | undefined;
  onChoose: (tool: Tool | undefined) => void;
  graphic: TacticalGraphic | undefined;
  onChooseGraphic: (graphic: TacticalGraphic | undefined) => void;
  symbol: SymbolChoice | undefined;
  onChooseSymbol: (symbol: SymbolChoice) => void;
  /** Why drawing is unavailable, or undefined when it is. */
  disabledReason: string | undefined;
  /** The plan new items go into; undefined = Live, straight to TAK. */
  planName: string | undefined;
  measuring: boolean;
  onToggleMeasure: () => void;
  /** Lasso selection on: drags draw an outline around items instead of panning. */
  lassoing: boolean;
  onToggleLasso: () => void;
  /** The measurement readout, shown while measuring. */
  children?: ReactNode;
  /** While an existing item's shape is being edited: its name and how to end the edit. */
  editing?: { name: string; saveLabel: string; onSave: () => void; onCancel: () => void };
  /** Several items picked together: shown in place of the drawing tools. */
  selection?: ReactNode;
  undo?: ReactNode;
};

/**
 * Undoes the latest change made in this session by writing again, so
 * whoever sees the item sees the undo too.
 */
export const UndoButton = ({
  subject,
  destination,
  disabledReason,
  onUndo,
}: {
  /** What the latest change was to; undefined when there is nothing to undo. */
  subject: string | undefined;
  /** Where the undo goes: TAK, or the plan being prepared. */
  destination: string;
  disabledReason: string | undefined;
  onUndo: () => void;
}) => (
  <Tooltip
    label={
      disabledReason ??
      (subject
        ? `Undo the latest change, to ${subject} (Ctrl+Z): sends the earlier version to ${destination} again, or deletes what was new.`
        : "Nothing changed in this session yet")
    }
    multiline
    w={280}
    withArrow
  >
    <Button
      size="compact-xs"
      variant="subtle"
      color="gray"
      leftSection={<IconArrowBackUp size={14} />}
      disabled={!!disabledReason || !subject}
      onClick={onUndo}
    >
      Undo
    </Button>
  </Tooltip>
);

/** Drawing tools over the map; the active tool shows how to use it. */
export const DrawToolbar = ({
  tool,
  onChoose,
  graphic,
  onChooseGraphic,
  symbol,
  onChooseSymbol,
  disabledReason,
  planName,
  measuring,
  onToggleMeasure,
  lassoing,
  onToggleLasso,
  children,
  editing,
  selection,
  undo,
}: Props) => (
  <Paper className="tak-draw-toolbar" shadow="sm" p={4} withBorder>
    {editing ? (
      <>
        <Group gap={4} wrap="nowrap" justify="space-between">
          <Text fz="xs" fw={600} px={6} truncate>
            Editing {editing.name}
          </Text>
          <Group gap={4} wrap="nowrap">
            <Button size="compact-xs" variant="subtle" color="gray" onClick={editing.onCancel}>
              Cancel (Esc)
            </Button>
            <Button size="compact-xs" onClick={editing.onSave}>
              {editing.saveLabel}
            </Button>
          </Group>
        </Group>
        <Text fz="xs" c="dimmed" px={6} pt={2}>
          {EDIT_HINT}
        </Text>
      </>
    ) : (
      (selection ?? (
        <ToolButtons
          tool={tool}
          graphic={graphic}
          onChooseGraphic={onChooseGraphic}
          symbol={symbol}
          onChooseSymbol={onChooseSymbol}
          onChoose={onChoose}
          disabledReason={disabledReason}
          planName={planName}
          measuring={measuring}
          onToggleMeasure={onToggleMeasure}
          lassoing={lassoing}
          onToggleLasso={onToggleLasso}
          undo={undo}
        >
          {children}
        </ToolButtons>
      ))
    )}
  </Paper>
);

const ToolButtons = ({
  tool,
  graphic,
  onChooseGraphic,
  symbol,
  onChooseSymbol,
  onChoose,
  disabledReason,
  planName,
  measuring,
  onToggleMeasure,
  lassoing,
  onToggleLasso,
  children,
  undo,
}: Omit<Props, "editing" | "selection">) => (
  <>
    <Group gap={4} justify="center">
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
      {DRAW_TOOLS.map((id) => {
        const Icon = ICONS[id];
        return (
          <Tooltip key={id} label={disabledReason} disabled={!disabledReason} withArrow>
            <Button
              size="compact-xs"
              variant={tool === id && !graphic && !symbol ? "filled" : "subtle"}
              color={tool === id && !graphic && !symbol ? "primary" : "gray"}
              leftSection={<Icon size={14} />}
              aria-pressed={tool === id && !graphic && !symbol}
              disabled={!!disabledReason}
              onClick={() => onChoose(tool === id && !graphic && !symbol ? undefined : id)}
            >
              {TOOLS[id].label}
            </Button>
          </Tooltip>
        );
      })}
      <SymbolPickerButton
        value={symbol}
        onChange={onChooseSymbol}
        disabledReason={disabledReason}
      />
      <TacticalGraphicPicker
        value={graphic}
        onChange={onChooseGraphic}
        disabledReason={disabledReason}
      />
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <Button
            size="compact-xs"
            variant={measuring || lassoing || isMenuTool(tool) ? "filled" : "subtle"}
            color={measuring || lassoing || isMenuTool(tool) ? "primary" : "gray"}
            leftSection={<IconTools size={14} />}
            rightSection={<IconChevronDown size={12} />}
          >
            Tools
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconRuler2 size={14} />} onClick={onToggleMeasure}>
            {measuring ? "Stop measuring" : "Measure"}
          </Menu.Item>
          <Menu.Item leftSection={<IconLasso size={14} />} onClick={onToggleLasso}>
            {lassoing ? "Stop lasso" : "Lasso select"}
          </Menu.Item>
          {MENU_TOOLS.map((id) => {
            const Icon = ICONS[id];
            return (
              <Menu.Item
                key={id}
                leftSection={<Icon size={14} />}
                disabled={!!disabledReason}
                title={disabledReason}
                onClick={() => onChoose(tool === id ? undefined : id)}
              >
                {TOOLS[id].label}
              </Menu.Item>
            );
          })}
        </Menu.Dropdown>
      </Menu>
      {undo}
      {(tool || measuring || lassoing) && (
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          leftSection={<IconX size={14} />}
          onClick={() =>
            measuring ? onToggleMeasure() : lassoing ? onToggleLasso() : onChoose(undefined)
          }
        >
          Stop (Esc)
        </Button>
      )}
    </Group>
    {lassoing && (
      <Text fz="xs" c="dimmed" px={6} pt={2}>
        {LASSO_HINT}
      </Text>
    )}
    {tool && (
      <Text fz="xs" c="dimmed" px={6} pt={2}>
        {(graphic && hintFor(graphic)) ?? (symbol ? SYMBOL_HINT : HINT[tool])}
      </Text>
    )}
    {measuring && children}
  </>
);
