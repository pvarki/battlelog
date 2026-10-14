import {
  ActionIcon,
  Alert,
  Button,
  CheckIcon,
  ColorSwatch,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPencil, IconPlus } from "@tabler/icons-react";
import { useState } from "react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import {
  FieldInput,
  OptionsEditor,
  QueryEditor,
  useFieldSuggestions,
} from "../../event-binding/editors.tsx";
import { STATUS_COLORS } from "../../event-binding/options.ts";
import { queryFilter } from "../../event-binding/query.ts";
import { type EventLayer, type LayerDefinition, newLayer } from "./layers.ts";
import { deleteLayer, saveLayer } from "./store.ts";

const WINDOWS = [
  { value: "1", label: "Last hour" },
  { value: "6", label: "Last 6 hours" },
  { value: "24", label: "Last 24 hours" },
  { value: "72", label: "Last 3 days" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
  { value: "all", label: "Any time" },
];

type Props = {
  layers: EventLayer[] | null;
  shown: ReadonlySet<string>;
  /** Undefined when this map's layers are fixed by its view. */
  onToggle?: (eventId: string) => void;
  /** Layers that hit the fetch limit, so some events aren't drawn. */
  truncated: ReadonlySet<string>;
};

/** The shared BattleLog layers: show or hide each on this map, and make or change them for everyone. */
export const EventLayersSection = ({ layers, shown, onToggle, truncated }: Props) => {
  const [editing, setEditing] = useState<{ layer?: EventLayer }>();
  return (
    <Stack gap={6}>
      <SectionHeading>BattleLog layers</SectionHeading>
      {layers === null ? (
        <Text fz="xs" c="dimmed">
          Loading…
        </Text>
      ) : layers.length === 0 ? (
        <Text fz="xs" c="dimmed">
          None yet. A layer puts the log's events with a position on the map, e.g. every drone
          sighting of the last 24 hours.
        </Text>
      ) : (
        layers.map((layer) => (
          <Group key={layer.eventId} gap="xs" wrap="nowrap" justify="space-between">
            <Switch
              size="xs"
              checked={shown.has(layer.eventId)}
              disabled={!onToggle}
              onChange={() => onToggle?.(layer.eventId)}
              label={
                <Group gap={6} wrap="nowrap">
                  <ColorSwatch
                    size={10}
                    color={`var(--mantine-color-${layer.definition.color}-5)`}
                  />
                  <span>{layer.definition.name || "(unnamed)"}</span>
                </Group>
              }
              description={
                truncated.has(layer.eventId) && shown.has(layer.eventId)
                  ? "Too many events: only the newest are shown"
                  : undefined
              }
            />
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={`Edit layer ${layer.definition.name}`}
              onClick={() => setEditing({ layer })}
            >
              <IconPencil size={14} />
            </ActionIcon>
          </Group>
        ))
      )}
      {!onToggle && layers?.length ? (
        <Text fz="xs" c="dimmed">
          This view chooses which layers its map shows.
        </Text>
      ) : null}
      <Button
        size="xs"
        variant="default"
        leftSection={<IconPlus size={14} />}
        onClick={() => setEditing({})}
      >
        New layer
      </Button>
      {editing && (
        <LayerDialog
          layer={editing.layer}
          onClose={() => setEditing(undefined)}
          onSaved={(eventId) => {
            if (!editing.layer && eventId && !shown.has(eventId)) onToggle?.(eventId);
          }}
        />
      )}
    </Stack>
  );
};

const LayerDialog = ({
  layer,
  onClose,
  onSaved,
}: {
  layer?: EventLayer;
  onClose: () => void;
  onSaved: (eventId: string | undefined) => void;
}) => {
  const [value, setValue] = useState<LayerDefinition>(layer?.definition ?? newLayer());
  const [problem, setProblem] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const suggestions = useFieldSuggestions(value.query);
  const set = (patch: Partial<LayerDefinition>) => setValue((v) => ({ ...v, ...patch }));
  const valid = !!value.name.trim() && !!queryFilter(value.query);

  const run = async (action: () => Promise<{ error?: string; eventId?: string }>) => {
    setSaving(true);
    const { error, eventId } = await action();
    setSaving(false);
    if (error) return setProblem(error);
    onSaved(eventId);
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title={layer ? "Edit layer" : "New layer"} size="lg">
      <Stack gap="sm">
        <Text fz="xs" c="dimmed">
          Layers are shared: everyone sees this layer and its changes. Only events with a position
          are drawn.
        </Text>
        <TextInput
          label="Name"
          size="xs"
          data-autofocus
          maxLength={80}
          value={value.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
        />
        <QueryEditor query={value.query} onChange={(query) => set({ query })} />
        <Select
          label="Events from"
          size="xs"
          data={WINDOWS}
          value={value.windowHours === undefined ? "all" : String(value.windowHours)}
          onChange={(v) => set({ windowHours: !v || v === "all" ? undefined : Number(v) })}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
        <Stack gap={4}>
          <Text fz="xs" fw={500}>
            Colour
          </Text>
          <Group gap={4}>
            {STATUS_COLORS.map((color) => (
              <ColorSwatch
                key={color}
                size={20}
                color={`var(--mantine-color-${color}-5)`}
                component="button"
                style={{ cursor: "pointer" }}
                aria-label={color}
                onClick={() => set({ color })}
              >
                {value.color === color && <CheckIcon size={10} color="black" />}
              </ColorSwatch>
            ))}
          </Group>
        </Stack>
        <FieldInput
          label="Label"
          description="A data field to show beside each event; empty shows its header"
          value={value.labelPath}
          suggestions={suggestions}
          onChange={(labelPath) => set({ labelPath })}
        />
        <FieldInput
          label="Colour by"
          description="A data field whose value sets the colour, e.g. a status"
          value={value.colorBy?.path ?? ""}
          suggestions={suggestions}
          onChange={(path) => set({ colorBy: { path, options: value.colorBy?.options ?? [] } })}
          onPick={(s) =>
            set({
              colorBy: {
                path: s.path,
                options: value.colorBy?.options.length
                  ? value.colorBy.options
                  : s.options.map((v) => ({ value: v, color: "gray" })),
              },
            })
          }
        />
        {value.colorBy?.path.trim() && (
          <OptionsEditor
            options={value.colorBy.options}
            onChange={(options) => set({ colorBy: { path: value.colorBy?.path ?? "", options } })}
          />
        )}
        {problem && (
          <Alert color="red" variant="light">
            {problem}
          </Alert>
        )}
        <Group justify="space-between">
          {layer ? (
            <Button
              size="xs"
              variant={confirmDelete ? "filled" : "subtle"}
              color="red"
              loading={saving}
              onClick={() =>
                confirmDelete ? void run(() => deleteLayer(layer)) : setConfirmDelete(true)
              }
            >
              {confirmDelete ? "Delete it for everyone" : "Delete"}
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button size="xs" variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="xs"
              disabled={!valid}
              loading={saving}
              onClick={() => void run(() => saveLayer(value, layer))}
            >
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
};
