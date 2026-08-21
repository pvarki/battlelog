import { Input, SegmentedControl, Select, Stack } from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import type { ClockConfig } from "./widget.ts";

const timeZones = Intl.supportedValuesOf("timeZone");

const ClockConfigForm = ({ config, onChange }: WidgetConfigProps<ClockConfig>) => (
  <Stack>
    <Select
      label="Timezone"
      placeholder="System default"
      searchable
      clearable
      data={timeZones}
      value={config.timeZone ?? null}
      onChange={(value) => onChange({ ...config, timeZone: value ?? undefined })}
    />
    <Input.Wrapper label="Time format">
      <SegmentedControl
        fullWidth
        data={[
          { label: "24-hour", value: "24h" },
          { label: "12-hour", value: "12h" },
        ]}
        value={config.format}
        onChange={(value) => onChange({ ...config, format: value as ClockConfig["format"] })}
      />
    </Input.Wrapper>
  </Stack>
);

export default ClockConfigForm;
