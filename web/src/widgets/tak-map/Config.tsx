import {
  Checkbox,
  ColorSwatch,
  Divider,
  Group,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { useTakState } from "../../tak-state.ts";
import { TEAMS, teamColor, withAutoTitle } from "./symbols.ts";
import { BASEMAPS, type Basemap, LAYER_LABEL, LAYERS, type TakMapConfig } from "./widget.ts";

const VIEWS: { value: TakMapConfig["view"]; label: string }[] = [
  { value: "fit-once", label: "Fit to items when opened" },
  { value: "fit-always", label: "Keep fitting to items (wall display)" },
  { value: "saved", label: "Saved view (pin it on the map)" },
];

const MAX_AGES = [
  { value: "all", label: "Show all" },
  { value: "15", label: "Updated in the last 15 min" },
  { value: "60", label: "Updated in the last hour" },
  { value: "360", label: "Updated in the last 6 hours" },
  { value: "1440", label: "Updated in the last 24 hours" },
];

const Section = ({ label }: { label: string }) => (
  <Divider label={label} labelPosition="left" mt="sm" />
);

const TakMapConfigForm = ({ config, onChange }: WidgetConfigProps<TakMapConfig>) => {
  const { missions } = useTakState();
  const set = (patch: Partial<TakMapConfig>) =>
    onChange(withAutoTitle(config, { ...config, ...patch }));
  const age = config.maxAgeMinutes === null ? "all" : String(config.maxAgeMinutes);
  const missionNames = [...new Set([...missions.map((m) => m.name), ...config.missionNames])];
  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => set({ title })} />
      <Section label="Map" />
      <Select
        label="Base map"
        data={Object.entries(BASEMAPS).map(([value, b]) => ({ value, label: b.label }))}
        value={config.basemap}
        allowDeselect={false}
        onChange={(value) => value && set({ basemap: value as Basemap })}
      />
      <Select
        label="Map view"
        data={VIEWS.map((v) => ({ ...v, disabled: v.value === "saved" && !config.savedView }))}
        value={config.view}
        allowDeselect={false}
        onChange={(value) => value && set({ view: value as TakMapConfig["view"] })}
      />
      <Select
        label="Labels"
        data={[
          { value: "auto", label: "When zoomed in" },
          { value: "always", label: "Always" },
          { value: "never", label: "Never" },
        ]}
        value={config.labels}
        allowDeselect={false}
        onChange={(value) => value && set({ labels: value as TakMapConfig["labels"] })}
      />
      <Switch
        label="Side panel open by default"
        checked={config.panelOpen}
        onChange={(e) => set({ panelOpen: e.currentTarget.checked })}
      />

      <Section label="What to show" />
      <Switch
        label="Live TAK items"
        description="Off shows only the selected missions"
        checked={config.showLive}
        onChange={(e) => set({ showLive: e.currentTarget.checked })}
      />
      <Checkbox.Group
        label="Layers"
        value={LAYERS.filter((l) => !config.hiddenLayers.includes(l))}
        onChange={(shown) => set({ hiddenLayers: LAYERS.filter((l) => !shown.includes(l)) })}
      >
        <Stack gap="xs" mt="xs">
          {LAYERS.map((l) => (
            <Checkbox key={l} value={l} label={LAYER_LABEL[l]} />
          ))}
        </Stack>
      </Checkbox.Group>
      <MultiSelect
        label="Teams"
        description="TAK users of these teams only; empty shows all"
        data={TEAMS}
        renderOption={({ option }) => (
          <Group gap="xs">
            <ColorSwatch color={teamColor(option.value)} size={12} />
            {option.value}
          </Group>
        )}
        value={config.teams}
        onChange={(teams) => set({ teams })}
        clearable
      />
      <Select
        label="Age"
        data={
          MAX_AGES.some((a) => a.value === age)
            ? MAX_AGES
            : [...MAX_AGES, { value: age, label: `Updated in the last ${age} min` }]
        }
        value={age}
        allowDeselect={false}
        onChange={(value) =>
          value && set({ maxAgeMinutes: value === "all" ? null : Number(value) })
        }
      />
      <Switch
        label="Show stale and offline items"
        checked={config.showStale}
        onChange={(e) => set({ showStale: e.currentTarget.checked })}
      />

      <Stack gap="xs">
        <Section label="Missions" />
        <SegmentedControl
          data={[
            { value: "except", label: "All but unchecked" },
            { value: "only", label: "Only checked" },
          ]}
          value={config.missionFilter}
          // Keep the same missions on screen; only what happens to new ones changes.
          onChange={(value) =>
            set({
              missionFilter: value as TakMapConfig["missionFilter"],
              missionNames: missionNames.filter((n) => !config.missionNames.includes(n)),
            })
          }
        />
        {missionNames.length === 0 && (
          <Text fz="xs" c="dimmed">
            No missions on the TAK Server.
          </Text>
        )}
        {missionNames.map((name) => (
          <Checkbox
            key={name}
            label={name}
            checked={config.missionNames.includes(name) === (config.missionFilter === "only")}
            onChange={() =>
              set({
                missionNames: config.missionNames.includes(name)
                  ? config.missionNames.filter((n) => n !== name)
                  : [...config.missionNames, name],
              })
            }
          />
        ))}
      </Stack>
    </Stack>
  );
};

export default TakMapConfigForm;
