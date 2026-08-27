import { NumberInput, Stack, Text } from "@mantine/core";
import type { WidgetConfigProps } from "../../dashboard/registry.ts";
import { TitleInput } from "../../dashboard/TitleInput.tsx";
import type { AlertsConfig } from "./widget.ts";

const AlertsConfigForm = ({ config, onChange }: WidgetConfigProps<AlertsConfig>) => (
  <Stack>
    <TitleInput value={config.title} onChange={(title) => onChange({ ...config, title })} />
    <Text fz="xs" c="dimmed">
      Tämä widget näyttää kaikkien näkymien hälytyssäännöt yhdessä listassa. Säännöt itse
      määritellään tapahtumasyöte-widgetin asetuksissa. Kuitatut hälytykset jäävät listaan harmaina
      — kuittaus kertoo että joku on nähnyt sen, ei poista sitä.
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
  </Stack>
);

export default AlertsConfigForm;
