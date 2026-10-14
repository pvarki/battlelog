import {
  Button,
  Checkbox,
  Input,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { useEventLayers } from "../../tak/event-layers/store.ts";
import { useMissions, useMissionsSync } from "../../tak/missions/store.ts";
import { GROUP_LABEL, groupPathLabel } from "../../tak/overlays.ts";
import { useTakItems, useTakSession } from "../../tak/session.ts";
import { TAK_TOOLS, type TakTool, TOOL_LABEL } from "../../tak/tools.ts";
import type { MapConfig } from "./widget.ts";

const GROUP_OPTIONS = Object.keys(GROUP_LABEL).map((key) => ({
  value: key,
  label: groupPathLabel(key),
}));

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
  const setFollow = (patch: Follow) =>
    onChange({ ...config, follow: followOf({ ...follow, ...patch }) });

  return (
    <Stack>
      <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
      <Input.Wrapper
        label="Display"
        description="Wall: no tools or clicks and larger symbols, for a screen read from across the room"
      >
        <SegmentedControl
          display="flex"
          mt={4}
          value={config.display}
          onChange={(display) => onChange({ ...config, display: display as MapConfig["display"] })}
          data={[
            { value: "normal", label: "Normal" },
            { value: "wall", label: "Wall" },
          ]}
        />
      </Input.Wrapper>
      {config.display === "normal" && (
        <Checkbox.Group
          label="Tools"
          value={config.tools}
          onChange={(tools) => onChange({ ...config, tools: tools as TakTool[] })}
        >
          <Stack gap="xs" mt="xs">
            {TAK_TOOLS.map((tool) => (
              <Checkbox key={tool} value={tool} label={TOOL_LABEL[tool]} />
            ))}
          </Stack>
        </Checkbox.Group>
      )}
      <MultiSelect
        label="Overlay groups shown"
        description="Empty: this browser's layer settings"
        data={GROUP_OPTIONS}
        value={config.groups ?? []}
        onChange={(groups) => onChange({ ...config, groups: groups.length ? groups : undefined })}
        searchable
        clearable
      />
      <MultiSelect
        label="Data Sync feeds shown"
        description="Shown besides the feeds this browser shows"
        data={[...new Set([...missionNames, ...config.missions])]}
        value={config.missions}
        onChange={(missions) => onChange({ ...config, missions })}
        searchable
        clearable
      />
      <MultiSelect
        label="BattleLog layers shown"
        description="Empty: this browser's layer settings. Make layers in the map's Layers panel."
        data={[
          ...layers.map((l) => ({ value: l.eventId, label: l.definition.name || "(unnamed)" })),
          ...(config.eventLayers ?? [])
            .filter((id) => !layers.some((l) => l.eventId === id))
            .map((id) => ({ value: id, label: "(deleted layer)" })),
        ]}
        value={config.eventLayers ?? []}
        onChange={(ids) => onChange({ ...config, eventLayers: ids.length ? ids : undefined })}
        searchable
        clearable
      />
      <Checkbox
        label="Bring a selection made in another widget into view"
        checked={config.centreOnSelection ?? true}
        onChange={(e) =>
          onChange({ ...config, centreOnSelection: e.currentTarget.checked ? undefined : false })
        }
      />
      <Input.Wrapper label="Follow" description="The map keeps these in view as they move">
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
      <Input.Wrapper label="Starting view">
        {config.view ? (
          <Stack gap={4} align="flex-start">
            <Text fz="sm">Opens where it was pinned.</Text>
            <Button
              size="xs"
              variant="default"
              onClick={() => onChange({ ...config, view: undefined })}
            >
              Unpin
            </Button>
          </Stack>
        ) : (
          <Text fz="sm" c="dimmed">
            Opens where this browser last left the map. Pin a view with "Open here" on the map while
            editing the dashboard.
          </Text>
        )}
      </Input.Wrapper>
    </Stack>
  );
};

export default MapConfigForm;
