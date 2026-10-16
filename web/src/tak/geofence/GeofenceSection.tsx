import { Button, Group, SegmentedControl, Select, Stack, Switch, Text } from "@mantine/core";
import { useState } from "react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import { editEvent, setGeofence } from "../commands.ts";
import {
  type CotEvent,
  GEOFENCE_MONITORS,
  GEOFENCE_TRIGGERS,
  type Geofence,
  type TakItem,
} from "../cot.ts";
import { MONITOR_LABEL } from "./geofence.ts";

const NEW_FENCE: Geofence = { trigger: "Entry", monitor: "TAKUsers", tracking: true };

const summary = (fence: Geofence) =>
  `${fence.trigger === "Both" ? "Entry and exit" : fence.trigger} · ${MONITOR_LABEL[fence.monitor]} · ${fence.tracking ? "monitored" : "not monitored"}`;

/** A closed shape's ATAK geofence: shown, and changed when `readOnly` is false. */
export const GeofenceSection = ({
  item,
  readOnly,
  onSubmit,
  submitLabel,
}: {
  item: TakItem;
  readOnly: boolean;
  onSubmit: (event: CotEvent) => void;
  submitLabel: string;
}) => {
  // Until the user changes something, the form follows the item as updates arrive.
  const [edited, setEdited] = useState<{ fence: Geofence | undefined }>();
  const fence = edited ? edited.fence : item.geofence;
  const setFence = (next: Geofence | undefined) => setEdited({ fence: next });
  const changed = JSON.stringify(fence) !== JSON.stringify(item.geofence);
  if (readOnly && !item.geofence) return null;
  const set = (patch: Partial<Geofence>) => setFence(fence && { ...fence, ...patch });
  // Custom is a list kept in ATAK; offered only so a fence that has it keeps it.
  const monitors = GEOFENCE_MONITORS.filter((m) => m !== "Custom" || item.geofence?.monitor === m);
  return (
    <Stack gap="xs">
      <SectionHeading>Geofence</SectionHeading>
      {readOnly && item.geofence ? (
        <Text fz="sm">{summary(item.geofence)}</Text>
      ) : (
        <>
          <Switch
            size="xs"
            label="Geofence"
            description="Make this shape an ATAK geofence"
            checked={!!fence}
            onChange={(e) =>
              setFence(e.currentTarget.checked ? (item.geofence ?? NEW_FENCE) : undefined)
            }
          />
          {fence && (
            <>
              <SegmentedControl
                size="xs"
                aria-label="Alert on"
                data={[...GEOFENCE_TRIGGERS]}
                value={fence.trigger}
                onChange={(trigger) => set({ trigger: trigger as Geofence["trigger"] })}
              />
              <Select
                size="xs"
                label="Watch"
                data={monitors.map((m) => ({ value: m, label: MONITOR_LABEL[m] }))}
                value={fence.monitor}
                onChange={(monitor) => monitor && set({ monitor: monitor as Geofence["monitor"] })}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
              <Switch
                size="xs"
                label="Monitor"
                description="TAK clients watching fences alert on crossings, this map included"
                checked={fence.tracking}
                onChange={(e) => set({ tracking: e.currentTarget.checked })}
              />
            </>
          )}
          {changed && (
            <Group gap="xs" justify="flex-end">
              <Button size="xs" variant="default" onClick={() => setEdited(undefined)}>
                Cancel
              </Button>
              <Button
                size="xs"
                onClick={() => {
                  onSubmit(editEvent(item, (detail) => setGeofence(detail, fence)));
                  setEdited(undefined);
                }}
              >
                {submitLabel}
              </Button>
            </Group>
          )}
        </>
      )}
    </Stack>
  );
};
