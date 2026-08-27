import { Checkbox, NumberInput, Stack, Text } from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import type { AlertsConfig } from "./widget.ts";

const AlertsConfigForm = ({ config, onChange }: WidgetConfigProps<AlertsConfig>) => (
  <Stack>
    <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
    <Text fz="xs" c="dimmed">
      Tämä widget näyttää kaikkien näkymien hälytyssäännöt yhdessä listassa. Säännöt itse
      määritellään tapahtumasyöte-widgetin asetuksissa.
    </Text>
    <NumberInput
      label="Tapahtumia tarkasteltavana"
      description="Kuinka monta viimeisintä tapahtumaa säännöt käydään läpi"
      min={20}
      max={1000}
      step={50}
      value={config.lookback}
      onChange={(v) => {
        if (typeof v === "number") onChange({ ...config, lookback: v });
      }}
    />
    <Checkbox
      label="Näytä kuitatut"
      description="Kuitatut jäävät listaan yliviivattuina"
      checked={config.showDismissed}
      onChange={(e) => onChange({ ...config, showDismissed: e.currentTarget.checked })}
    />
  </Stack>
);

export default AlertsConfigForm;
