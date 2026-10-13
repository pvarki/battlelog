import {
  Button,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  type Affiliation,
  hasAffiliation,
  pointsProblem,
  type TacticalGraphic,
  type TacticalLook,
} from "./tactical-graphics.ts";

type Props = {
  graphic: TacticalGraphic;
  pointCount: number;
  value: TacticalLook;
  onChange: (look: TacticalLook) => void;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
};

/** Name and side for a tactical graphic just drawn; the map previews it as it will look. */
export const TacticalGraphicDialog = ({
  graphic,
  pointCount,
  value,
  onChange,
  onCancel,
  onSave,
  saveLabel,
}: Props) => {
  const problem = pointsProblem(graphic, pointCount);
  return (
    <Modal
      opened
      onClose={onCancel}
      title={graphic.name}
      centered
      overlayProps={{ backgroundOpacity: 0.15 }}
    >
      <Stack
        gap="sm"
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <TextInput
          size="xs"
          label="Name"
          description="Shown on the graphic, e.g. ALFA on a phase line"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.currentTarget.value })}
          data-autofocus
        />
        {hasAffiliation(graphic) && (
          <SegmentedControl
            size="xs"
            data={[
              { value: "friendly", label: "Friendly" },
              { value: "hostile", label: "Hostile" },
            ]}
            value={value.affiliation}
            onChange={(v) => onChange({ ...value, affiliation: v as Affiliation })}
          />
        )}
        <Textarea
          size="xs"
          label="Remarks"
          autosize
          minRows={2}
          maxRows={6}
          value={value.remarks}
          onChange={(e) => onChange({ ...value, remarks: e.currentTarget.value })}
        />
        {problem && (
          <Text fz="xs" c="red">
            {problem}: discard and draw it again.
          </Text>
        )}
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="default" onClick={onCancel}>
            Discard
          </Button>
          <Button size="xs" type="submit" disabled={!value.name.trim() || !!problem}>
            {saveLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
