import { Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { WidgetViewProps } from "../../dashboard/registry.ts";
import type { ClockConfig } from "./widget.ts";

const ClockView = ({ config }: WidgetViewProps<ClockConfig>) => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeZone = config.timeZone || undefined;
  // A fixed locale, as in time.ts: two screens in one room must read the same.
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: config.format === "12h",
    timeZone,
  }).format(now);
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  })
    .format(now)
    .replace(/\//g, ".");

  return (
    <Stack align="center" justify="center" h="100%" gap={4} style={{ containerType: "size" }}>
      {/* 12h strings run 11 chars; scale with the widget so they never clip.
          Digits hold still via tabular figures (global.css), not monospace. */}
      <Text fw={600} lh={1} style={{ fontSize: "min(11cqw, 45cqh, 3rem)" }}>
        {time}
      </Text>
      <Text c="dimmed" lh={1.2} style={{ fontSize: "min(var(--mantine-font-size-sm), 14cqh)" }}>
        {date}
      </Text>
      {config.timeZone && (
        <Text c="dimmed" fz="xs">
          {config.timeZone}
        </Text>
      )}
    </Stack>
  );
};

export default ClockView;
