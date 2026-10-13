import { Button, Checkbox, Input, Stack, Text } from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import { TAK_TOOLS, type TakTool, TOOL_LABEL } from "../../tak/tools.ts";
import type { MapConfig } from "./widget.ts";

const MapConfigForm = ({ config, onChange }: WidgetConfigProps<MapConfig>) => (
  <Stack>
    <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
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

export default MapConfigForm;
