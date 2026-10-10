import { Checkbox, Select, Stack } from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { BASEMAPS, type Basemap, LAYER_LABEL, LAYERS, type TakMapConfig } from "./widget.ts";

const TakMapConfigForm = ({ config, onChange }: WidgetConfigProps<TakMapConfig>) => (
  <Stack>
    <Select
      label="Base map"
      data={Object.entries(BASEMAPS).map(([value, b]) => ({ value, label: b.label }))}
      value={config.basemap}
      allowDeselect={false}
      onChange={(value) => value && onChange({ ...config, basemap: value as Basemap })}
    />
    <Checkbox.Group
      label="Layers"
      value={LAYERS.filter((l) => !config.hiddenLayers?.includes(l))}
      onChange={(shown) =>
        onChange({ ...config, hiddenLayers: LAYERS.filter((l) => !shown.includes(l)) })
      }
    >
      <Stack gap="xs" mt="xs">
        {LAYERS.map((l) => (
          <Checkbox key={l} value={l} label={LAYER_LABEL[l]} />
        ))}
      </Stack>
    </Checkbox.Group>
  </Stack>
);

export default TakMapConfigForm;
