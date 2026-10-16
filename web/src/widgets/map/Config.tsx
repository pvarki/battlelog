import {
  Accordion,
  Button,
  Checkbox,
  Input,
  MultiSelect,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Text,
} from "@mantine/core";
import type { ReactNode } from "react";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { useTakSession } from "../../tak/connect.ts";
import { useEventLayers } from "../../tak/event-layers/store.ts";
import { BUILTIN_SOURCES } from "../../tak/map/basemaps.ts";
import { useMissions, useMissionsSync } from "../../tak/missions/store.ts";
import { GROUP_LABEL, groupPathLabel } from "../../tak/overlays.ts";
import { useTakItems } from "../../tak/session.ts";
import {
  CARD_ACTION_LABEL,
  CARD_ACTIONS,
  type CardAction,
  CONTROL_LABEL,
  MAP_CONTROLS,
  type MapControl,
} from "../../tak/view-options.ts";
import { effectiveMap, type MapConfig } from "./widget.ts";

const GROUP_OPTIONS = Object.keys(GROUP_LABEL).map((key) => ({
  value: key,
  label: groupPathLabel(key),
}));
const MAP_OPTIONS = BUILTIN_SOURCES.map((s) => ({ value: s.id, label: s.label }));

type Follow = NonNullable<MapConfig["follow"]>;

/** Drops what's empty, so following nothing leaves no `follow` behind. */
const followOf = ({ callsigns, mission, groups }: Follow): Follow | undefined => {
  const follow = {
    ...(callsigns?.length ? { callsigns } : {}),
    ...(mission ? { mission } : {}),
    ...(groups?.length ? { groups } : {}),
  };
  return Object.keys(follow).length ? follow : undefined;
};

/** An on/off setting that can also be left to someone else: the viewer's browser or the preset. */
const Tristate = ({
  label,
  description,
  inherit,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  /** What leaving it unset means, e.g. "Viewer's". */
  inherit: string;
  value: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}) => (
  <Input.Wrapper label={label} description={description}>
    <SegmentedControl
      display="flex"
      mt={4}
      size="xs"
      value={value === undefined ? "inherit" : value ? "on" : "off"}
      onChange={(v) => onChange(v === "inherit" ? undefined : v === "on")}
      data={[
        { value: "inherit", label: inherit },
        { value: "on", label: "On" },
        { value: "off", label: "Off" },
      ]}
    />
  </Input.Wrapper>
);

const Section = ({
  value,
  title,
  children,
}: {
  value: string;
  title: string;
  children: ReactNode;
}) => (
  <Accordion.Item value={value}>
    <Accordion.Control>{title}</Accordion.Control>
    <Accordion.Panel>
      <Stack>{children}</Stack>
    </Accordion.Panel>
  </Accordion.Item>
);

const MapConfigForm = ({ config, onChange }: WidgetConfigProps<MapConfig>) => {
  useTakSession();
  useMissionsSync([]);
  const items = useTakItems();
  const missionNames = (useMissions().missions ?? []).map((m) => m.name).sort();
  const follow = config.follow ?? {};
  const callsigns = [
    ...new Set([
      ...items.flatMap((i) => (i.team && i.callsign ? [i.callsign] : [])),
      ...(follow.callsigns ?? []),
    ]),
  ].sort();
  const layers = useEventLayers() ?? [];
  const effective = effectiveMap(config);
  const set = (patch: Partial<MapConfig>) => onChange({ ...config, ...patch });
  const setFollow = (patch: Follow) => set({ follow: followOf({ ...follow, ...patch }) });
  const preset = config.display === "wall" ? "Wall's" : "Default";

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => set({ title })} />
      <Input.Wrapper
        label="Preset"
        description="Wall: larger symbols, no clicks, only the connection shown; for a screen read from across the room. Everything below can still be changed."
      >
        <SegmentedControl
          display="flex"
          mt={4}
          value={config.display}
          onChange={(display) => set({ display: display as MapConfig["display"] })}
          data={[
            { value: "normal", label: "Normal" },
            { value: "wall", label: "Wall" },
          ]}
        />
      </Input.Wrapper>

      <Accordion multiple defaultValue={["content"]} variant="separated">
        <Section value="content" title="What it shows">
          <Select
            label="Background map"
            description="Only built-in maps: maps added in a browser can't be shared"
            placeholder="Viewer's own choice"
            data={MAP_OPTIONS}
            value={config.basemap ?? null}
            onChange={(basemap) => set({ basemap: basemap ?? undefined })}
            clearable
          />
          <Select
            label="Overlay map"
            description="Drawn see-through over the background"
            placeholder="Viewer's own choice"
            data={MAP_OPTIONS}
            value={config.overlay?.source ?? null}
            onChange={(source) =>
              set({
                overlay: source ? { source, opacity: config.overlay?.opacity ?? 0.5 } : undefined,
              })
            }
            clearable
          />
          {config.overlay && (
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={config.overlay.opacity}
              onChange={(opacity) =>
                config.overlay && set({ overlay: { ...config.overlay, opacity } })
              }
              label={(v) => `${Math.round(v * 100)} %`}
              aria-label="Overlay opacity"
            />
          )}
          <Tristate
            label="Dim the background map"
            inherit="Viewer's"
            value={config.dim}
            onChange={(dim) => set({ dim })}
          />
          <Tristate
            label="MGRS grid"
            inherit="Viewer's"
            value={config.mgrsGrid}
            onChange={(mgrsGrid) => set({ mgrsGrid })}
          />
          <Tristate
            label="Movement tracks"
            description="Where moving users and units went in the last 2 hours"
            inherit="Viewer's"
            value={config.tracks}
            onChange={(tracks) => set({ tracks })}
          />
          <MultiSelect
            label="TAK overlay groups"
            description="Empty: the viewer's own layer settings"
            data={GROUP_OPTIONS}
            value={config.groups ?? []}
            onChange={(groups) => set({ groups: groups.length ? groups : undefined })}
            searchable
            clearable
          />
          <MultiSelect
            label="Data Sync feeds"
            description="Shown besides the feeds the viewer shows"
            data={[...new Set([...missionNames, ...config.missions])]}
            value={config.missions}
            onChange={(missions) => set({ missions })}
            searchable
            clearable
          />
          <MultiSelect
            label="BattleLog layers"
            description="Empty: the viewer's own choice. Make layers in the Map page's Layers panel."
            data={[
              ...layers.map((l) => ({ value: l.eventId, label: l.definition.name || "(unnamed)" })),
              ...(config.eventLayers ?? [])
                .filter((id) => !layers.some((l) => l.eventId === id))
                .map((id) => ({ value: id, label: "(deleted layer)" })),
            ]}
            value={config.eventLayers ?? []}
            onChange={(ids) => set({ eventLayers: ids.length ? ids : undefined })}
            searchable
            clearable
          />
        </Section>

        <Section value="view" title="Where it looks">
          <Input.Wrapper label="Starting view">
            {config.view ? (
              <Stack gap={4} align="flex-start">
                <Text fz="sm">Opens where it was pinned.</Text>
                <Button size="xs" variant="default" onClick={() => set({ view: undefined })}>
                  Unpin
                </Button>
              </Stack>
            ) : (
              <Text fz="sm" c="dimmed">
                Opens where the viewer's browser last left a map. Pin a view with "Open here" on the
                map while editing the dashboard.
              </Text>
            )}
          </Input.Wrapper>
          <Input.Wrapper
            label="Follow"
            description="Keeps these in view as they move. A viewer moving the map pauses it until they resume."
          >
            <Stack gap="xs" mt={4}>
              <MultiSelect
                placeholder="TAK users"
                data={callsigns}
                value={follow.callsigns ?? []}
                onChange={(callsigns) => setFollow({ callsigns })}
                searchable
                clearable
              />
              <Select
                placeholder="A Data Sync feed's items"
                data={[...new Set([...missionNames, ...(follow.mission ? [follow.mission] : [])])]}
                value={follow.mission ?? null}
                onChange={(mission) => setFollow({ mission: mission ?? undefined })}
                searchable
                clearable
              />
              <MultiSelect
                placeholder="Overlay groups"
                data={GROUP_OPTIONS}
                value={follow.groups ?? []}
                onChange={(groups) => setFollow({ groups })}
                searchable
                clearable
              />
            </Stack>
          </Input.Wrapper>
          <Input.Wrapper label="Symbol size" description={`${preset}: ×${effective.symbolScale}`}>
            <Slider
              mt="xs"
              min={0.5}
              max={3}
              step={0.25}
              value={effective.symbolScale}
              onChange={(symbolScale) => set({ symbolScale })}
              label={(v) => `×${v}`}
              aria-label="Symbol size"
            />
          </Input.Wrapper>
        </Section>

        <Section value="controls" title="What viewers can do">
          <Checkbox.Group
            label="Controls on the map"
            value={[...effective.controls]}
            onChange={(controls) => set({ controls: controls as MapControl[] })}
          >
            <Stack gap="xs" mt="xs">
              {MAP_CONTROLS.map((control) => (
                <Checkbox key={control} value={control} label={CONTROL_LABEL[control]} />
              ))}
            </Stack>
          </Checkbox.Group>
          <Tristate
            label="Move and zoom the map"
            description="Off: only following and selections move it"
            inherit={preset}
            value={config.panZoom}
            onChange={(panZoom) => set({ panZoom })}
          />
          <Tristate
            label="Select items"
            description="Clicking an item shows its card"
            inherit={preset}
            value={config.select}
            onChange={(select) => set({ select })}
          />
          {effective.select && (
            <Checkbox.Group
              label="Card actions"
              value={[...effective.cardActions]}
              onChange={(actions) => set({ cardActions: actions as CardAction[] })}
            >
              <Stack gap="xs" mt="xs">
                {CARD_ACTIONS.map((action) => (
                  <Checkbox key={action} value={action} label={CARD_ACTION_LABEL[action]} />
                ))}
              </Stack>
            </Checkbox.Group>
          )}
        </Section>

        <Section value="dashboard" title="With other widgets">
          <Checkbox
            label="Share selections, so other widgets follow them"
            checked={effective.shareSelection}
            onChange={(e) => set({ shareSelection: e.currentTarget.checked ? undefined : false })}
          />
          <Checkbox
            label="Bring a selection made in another widget into view"
            checked={effective.centreOnSelection}
            onChange={(e) =>
              set({ centreOnSelection: e.currentTarget.checked ? undefined : false })
            }
          />
          <Tristate
            label={'Answer a form\'s "Pick on map"'}
            description="Off: the form opens its own map instead"
            inherit={preset}
            value={config.answerPicks}
            onChange={(answerPicks) => set({ answerPicks })}
          />
        </Section>
      </Accordion>
    </Stack>
  );
};

export default MapConfigForm;
