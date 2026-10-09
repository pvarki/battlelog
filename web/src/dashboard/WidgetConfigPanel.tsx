import { Loader, Stack, Switch } from "@mantine/core";
import { Suspense } from "react";
import type { Widget } from "../api.ts";
import { validateWidgetConfig, type WidgetDescriptor } from "./registry.ts";

export const WidgetConfigPanel = ({
  widget,
  descriptor,
  onChange,
}: {
  widget: Pick<Widget, "type" | "config">;
  descriptor: WidgetDescriptor;
  onChange: (next: unknown) => void;
}) => {
  const ConfigForm = descriptor.ConfigForm;
  const validation = validateWidgetConfig(widget.type, widget.config);
  const formConfig = validation.ok
    ? validation.value
    : {
        ...(descriptor.defaultConfig as Record<string, unknown>),
        ...(widget.config as Record<string, unknown>),
      };
  return (
    <Stack>
      {descriptor.showOnMobile !== false && (
        <Switch
          label="Show on mobile"
          description="Include this widget in the phone view of the dashboard"
          checked={(formConfig as { showOnMobile?: boolean }).showOnMobile !== false}
          onChange={(e) =>
            onChange({
              ...(formConfig as Record<string, unknown>),
              showOnMobile: e.currentTarget.checked,
            })
          }
        />
      )}
      {ConfigForm && (
        <Suspense fallback={<Loader size="sm" />}>
          <ConfigForm config={formConfig} onChange={onChange} />
        </Suspense>
      )}
    </Stack>
  );
};
