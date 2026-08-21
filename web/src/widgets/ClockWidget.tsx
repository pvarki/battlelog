import { Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";

export const ClockWidget = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Stack align="center" justify="center" h="100%" gap={4}>
      <Text ff="monospace" fz={42} fw={600} lh={1}>
        {now.toLocaleTimeString()}
      </Text>
      <Text c="dimmed" fz="sm">
        {now.toLocaleDateString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </Text>
    </Stack>
  );
};
