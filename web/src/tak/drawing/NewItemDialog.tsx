import {
  Button,
  ColorSwatch,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useEffect, useState } from "react";
import type { StrokeStyle } from "../cot.ts";
import { useIconsets } from "../map/iconsets.ts";
import { formatDistance } from "../map/layers.ts";
import { IconsetPicker } from "./IconsetPicker.tsx";
import {
  defaultWaypointNames,
  type NewMarker,
  type NewRoute,
  type ShapeStyle,
} from "./new-items.ts";
import { DEFAULT_SYMBOL, SymbolPicker } from "./SymbolPicker.tsx";
import { cotTypeOf, type SymbolChoice, sidcOf } from "./symbol-catalogue.ts";
import type { Drawn } from "./useDrawing.ts";

/** ATAK's drawing palette. */
const COLORS = [
  "#ffffff",
  "#ffff00",
  "#ff7700",
  "#ff0000",
  "#ff00ff",
  "#0000ff",
  "#00ffff",
  "#00ff00",
  "#000000",
];

const MARKER_KINDS: { value: NewMarker["kind"]; label: string }[] = [
  { value: "spot", label: "Spot" },
  { value: "h", label: "Hostile" },
  { value: "f", label: "Friendly" },
  { value: "n", label: "Neutral" },
  { value: "u", label: "Unknown" },
  { value: "symbol", label: "Symbol" },
];
const ICON_KIND = { value: "icon" as const, label: "Icon" };

const KIND_LABEL = {
  marker: "Marker",
  line: "Line",
  polygon: "Area",
  rectangle: "Rectangle",
  circle: "Circle",
  route: "Route",
};

export const Palette = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) => (
  <Group gap={6} role="radiogroup" aria-label="Colour">
    {COLORS.map((color) => (
      <UnstyledButton
        key={color}
        role="radio"
        aria-checked={value === color}
        aria-label={color}
        onClick={() => onChange(color)}
      >
        <ColorSwatch
          color={color}
          size={22}
          style={{ outline: value === color ? "2px solid #8abbff" : undefined, outlineOffset: 2 }}
        />
      </UnstyledButton>
    ))}
  </Group>
);

type Props = {
  drawn: Drawn;
  defaultName: string;
  onCancel: () => void;
  onSaveShape: (style: ShapeStyle) => void;
  onSaveMarker: (marker: Omit<NewMarker, "position">) => void;
  onSaveRoute: (route: Omit<NewRoute, "points">) => void;
  saveLabel: string;
  /** Hears the shape's style as it is chosen, so the map can show the result before saving. */
  onStyle?: (style: ShapeStyle) => void;
  /** A symbol chosen before the marker was placed. */
  initialSymbol?: SymbolChoice;
};

/** Name and style for what was just drawn, then it goes to TAK. */
export const NewItemDialog = ({
  drawn,
  defaultName,
  onCancel,
  onSaveShape,
  onSaveMarker,
  onSaveRoute,
  saveLabel,
  onStyle,
  initialSymbol,
}: Props) => {
  const [name, setName] = useState(defaultName);
  const [remarks, setRemarks] = useState("");
  const [color, setColor] = useState("#ffff00");
  const [strokeStyle, setStrokeStyle] = useState<StrokeStyle>("solid");
  const [strokeWeight, setStrokeWeight] = useState(3);
  const [fillOpacity, setFillOpacity] = useState(0.25);
  const [labelsOn, setLabelsOn] = useState(drawn.kind === "circle");
  const [sidc, setSidc] = useState("");
  const [markerKind, setMarkerKind] = useState<NewMarker["kind"]>(
    initialSymbol ? "symbol" : "spot",
  );
  const [symbol, setSymbol] = useState(initialSymbol ?? DEFAULT_SYMBOL);
  const [icon, setIcon] = useState<NewMarker["icon"]>();
  const hasIconsets = useIconsets().sets.length > 0;
  const [waypointNames, setWaypointNames] = useState(
    drawn.kind === "route" ? defaultWaypointNames(defaultName, drawn.points.length) : [],
  );
  const isMarker = drawn.kind === "marker";
  const isRoute = drawn.kind === "route";
  const closed = drawn.kind !== "marker" && drawn.kind !== "line" && !isRoute;
  const missingIcon = isMarker && markerKind === "icon" && !icon;

  const shapeStyle = (): ShapeStyle => ({
    name: name.trim(),
    remarks,
    stroke: color,
    strokeWeight,
    strokeStyle,
    fillOpacity: closed ? fillOpacity : 0,
    labelsOn,
    sidc: sidc.trim() || undefined,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-announce only when a styled field changes
  useEffect(() => {
    if (!isMarker && !isRoute) onStyle?.(shapeStyle());
  }, [onStyle, name, color, strokeWeight, strokeStyle, fillOpacity, labelsOn, sidc]);

  const save = () => {
    if (isMarker)
      onSaveMarker({
        name: name.trim(),
        remarks,
        kind: markerKind,
        color,
        icon,
        symbol:
          markerKind === "symbol" ? { sidc: sidcOf(symbol), type: cotTypeOf(symbol) } : undefined,
      });
    else if (isRoute) onSaveRoute({ name: name.trim(), remarks, color, waypointNames });
    else onSaveShape(shapeStyle());
  };

  return (
    <Modal
      opened
      onClose={onCancel}
      title={`New ${KIND_LABEL[drawn.kind].toLowerCase()}`}
      size={isMarker && markerKind === "symbol" ? "lg" : "md"}
      centered
    >
      <Stack
        gap="sm"
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {drawn.kind === "circle" && (
          <Text fz="xs" c="dimmed">
            Radius {formatDistance(drawn.radius)}
          </Text>
        )}
        <TextInput
          size="xs"
          label="Name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
        />
        {isMarker && (
          <SegmentedControl
            size="xs"
            data={hasIconsets ? [...MARKER_KINDS, ICON_KIND] : MARKER_KINDS}
            value={markerKind}
            onChange={(v) => setMarkerKind(v as NewMarker["kind"])}
          />
        )}
        {isMarker && markerKind === "symbol" && (
          <SymbolPicker value={symbol} onChange={setSymbol} name={name.trim()} />
        )}
        {isMarker && markerKind === "icon" && (
          <IconsetPicker value={icon?.path} onChange={setIcon} />
        )}
        {(!isMarker || markerKind === "spot") && (
          <div>
            <Text fz="xs" fw={500} mb={4}>
              Colour
            </Text>
            <Palette value={color} onChange={setColor} />
          </div>
        )}
        {isRoute && (
          <Stack gap={4}>
            <Text fz="xs" fw={500}>
              Checkpoints
            </Text>
            <Text fz="xs" c="dimmed">
              A point without a name is an unnamed turn point.
            </Text>
            {waypointNames.map((waypoint, i) => (
              <TextInput
                // biome-ignore lint/suspicious/noArrayIndexKey: one input per drawn point, in order
                key={i}
                size="xs"
                aria-label={`Checkpoint ${i + 1} name`}
                leftSection={<Text fz="xs">{i + 1}</Text>}
                value={waypoint}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setWaypointNames((names) => names.map((n, j) => (j === i ? value : n)));
                }}
              />
            ))}
          </Stack>
        )}
        {!isMarker && !isRoute && (
          <>
            <Group grow>
              <Select
                size="xs"
                label="Line"
                data={[
                  { value: "solid", label: "Solid" },
                  { value: "dashed", label: "Dashed" },
                  { value: "dotted", label: "Dotted" },
                  { value: "outlined", label: "Outlined" },
                ]}
                value={strokeStyle}
                onChange={(v) => v && setStrokeStyle(v as StrokeStyle)}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
              <div>
                <Text fz="xs" fw={500} mb={10}>
                  Width {strokeWeight}
                </Text>
                <Slider
                  size="xs"
                  min={1}
                  max={8}
                  step={1}
                  value={strokeWeight}
                  onChange={setStrokeWeight}
                  label={null}
                  aria-label="Line width"
                />
              </div>
            </Group>
            {closed && (
              <div>
                <Text fz="xs" fw={500} mb={10}>
                  Fill {Math.round(fillOpacity * 100)} %
                </Text>
                <Slider
                  size="xs"
                  min={0}
                  max={1}
                  step={0.05}
                  value={fillOpacity}
                  onChange={setFillOpacity}
                  label={null}
                  aria-label="Fill opacity"
                />
              </div>
            )}
            <Switch
              size="xs"
              label="Show name and measurements"
              checked={labelsOn}
              onChange={(e) => setLabelsOn(e.currentTarget.checked)}
            />
            <TextInput
              size="xs"
              label="Tactical graphic code (optional)"
              description="2525C code as ATAK uses it, e.g. G*G*GLB---****X for a boundary"
              value={sidc}
              onChange={(e) => setSidc(e.currentTarget.value.toUpperCase())}
            />
          </>
        )}
        <Textarea
          size="xs"
          label="Remarks"
          autosize
          minRows={2}
          maxRows={6}
          value={remarks}
          onChange={(e) => setRemarks(e.currentTarget.value)}
        />
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="default" onClick={onCancel}>
            Discard
          </Button>
          <Button size="xs" type="submit" disabled={!name.trim() || missingIcon}>
            {saveLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
