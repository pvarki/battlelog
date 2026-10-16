import {
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Palette } from "./NewItemDialog.tsx";

/** What the range rings or bullseye dialog sets; the bullseye-only fields are ignored for rings. */
export type RingsLook = {
  name: string;
  /** #rrggbb */
  color: string;
  remarks: string;
  count: number;
  /** Metres. */
  spacing: number;
  /** The bullseye's radius in metres. */
  radius: number;
  mils: boolean;
  edgeToCenter: boolean;
  /** Whether the bullseye has range rings inside it. */
  showRings: boolean;
};

export const defaultRingsLook = (name: string): RingsLook => ({
  name,
  color: "#ffff00",
  remarks: "",
  count: 3,
  spacing: 500,
  radius: 2000,
  mils: false,
  edgeToCenter: false,
  showRings: false,
});

const MAX_RINGS = 20;

type Props = {
  kind: "rings" | "bullseye";
  value: RingsLook;
  onChange: (look: RingsLook) => void;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
};

/** Range rings or a bullseye around the clicked point; the map previews them as they will look. */
export const RingsDialog = ({ kind, value, onChange, onCancel, onSave, saveLabel }: Props) => {
  const isBullseye = kind === "bullseye";
  const hasRings = !isBullseye || value.showRings;
  const set = (change: Partial<RingsLook>) => onChange({ ...value, ...change });
  const numberOf = (input: number | string) => (typeof input === "number" ? input : 0);
  const valid =
    value.name.trim() &&
    (!isBullseye || value.radius > 0) &&
    (!hasRings || (value.spacing > 0 && value.count >= 1));
  return (
    <Modal
      opened
      onClose={onCancel}
      title={isBullseye ? "New bullseye" : "New range rings"}
      centered
      overlayProps={{ backgroundOpacity: 0.15 }}
    >
      <Stack
        gap="sm"
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave();
        }}
      >
        <TextInput
          size="xs"
          label="Name"
          value={value.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
          data-autofocus
        />
        <div>
          <Text fz="xs" fw={500} mb={4}>
            Colour
          </Text>
          <Palette value={value.color} onChange={(color) => set({ color })} />
        </div>
        {isBullseye && (
          <>
            <NumberInput
              size="xs"
              label="Radius (m)"
              min={1}
              value={value.radius}
              onChange={(v) => set({ radius: numberOf(v) })}
            />
            <SegmentedControl
              size="xs"
              aria-label="Bearings in"
              data={[
                { value: "degrees", label: "Degrees" },
                { value: "mils", label: "Mils" },
              ]}
              value={value.mils ? "mils" : "degrees"}
              onChange={(v) => set({ mils: v === "mils" })}
            />
            <Switch
              size="xs"
              label="Bearings from the edge to the centre"
              checked={value.edgeToCenter}
              onChange={(e) => set({ edgeToCenter: e.currentTarget.checked })}
            />
            <Switch
              size="xs"
              label="Range rings"
              checked={value.showRings}
              onChange={(e) => set({ showRings: e.currentTarget.checked })}
            />
          </>
        )}
        {hasRings && (
          <Group grow>
            <NumberInput
              size="xs"
              label="Rings"
              min={1}
              max={MAX_RINGS}
              allowDecimal={false}
              value={value.count}
              onChange={(v) => set({ count: Math.min(MAX_RINGS, numberOf(v)) })}
            />
            <NumberInput
              size="xs"
              label="Spacing (m)"
              min={1}
              value={value.spacing}
              onChange={(v) => set({ spacing: numberOf(v) })}
            />
          </Group>
        )}
        <Textarea
          size="xs"
          label="Remarks"
          autosize
          minRows={2}
          maxRows={6}
          value={value.remarks}
          onChange={(e) => set({ remarks: e.currentTarget.value })}
        />
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="default" onClick={onCancel}>
            Discard
          </Button>
          <Button size="xs" type="submit" disabled={!valid}>
            {saveLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
