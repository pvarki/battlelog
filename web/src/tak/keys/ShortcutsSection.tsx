import { ActionIcon, Button, Group, Kbd, Stack, Text, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { SectionHeading } from "../../components/SectionHeading.tsx";
import {
  ACTION_GROUPS,
  ACTIONS,
  assign,
  bindingOf,
  formatBinding,
  isReserved,
  resetAction,
} from "./bindings.ts";
import { useKeymap } from "./useKeymap.ts";

/** Every shortcut, changed by clicking it and pressing the new keys. */
export const ShortcutsSection = () => {
  const { overrides, setOverrides, keymap } = useKeymap();
  const [recording, setRecording] = useState<string>();

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setRecording(undefined);
      if (e.key === "Backspace" || e.key === "Delete") {
        setOverrides((o) => ({ ...o, [recording]: [] }));
        return setRecording(undefined);
      }
      const binding = bindingOf(e);
      if (!binding) return;
      if (isReserved(binding)) {
        notifications.show({
          color: "warning",
          message: `${formatBinding(binding)} is kept for the map and lists. Try another key.`,
        });
        return;
      }
      const { overrides: next, takenFrom } = assign(overrides, keymap, recording, binding);
      setOverrides(next);
      setRecording(undefined);
      const from = ACTIONS.find((a) => a.id === takenFrom);
      if (from)
        notifications.show({
          message: `${formatBinding(binding)} no longer does “${from.label}”.`,
        });
    };
    // Capture: the map's own shortcuts must not fire while a new key is being chosen.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [recording, overrides, keymap, setOverrides]);

  const changed = Object.keys(overrides).length > 0;

  return (
    <Stack gap="md">
      {ACTION_GROUPS.map((group) => (
        <Stack key={group} gap={2}>
          <SectionHeading>{group}</SectionHeading>
          {ACTIONS.filter((a) => a.group === group).map((action) => {
            const keys = keymap.get(action.id) ?? [];
            const isRecording = recording === action.id;
            return (
              <Group key={action.id} className="tak-row" gap={6} wrap="nowrap">
                <Text fz="sm" truncate style={{ flex: 1 }}>
                  {action.label}
                </Text>
                {overrides[action.id] && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label={`Back to the default for ${action.label}`}
                    title="Back to the default"
                    onClick={() => setOverrides(resetAction(overrides, keymap, action.id))}
                  >
                    <IconArrowBackUp size={16} />
                  </ActionIcon>
                )}
                <UnstyledButton
                  className="tak-shortcut"
                  data-recording={isRecording || undefined}
                  aria-label={
                    isRecording
                      ? `Press the new keys for ${action.label}`
                      : `${action.label}: ${keys.map((k) => formatBinding(k)).join(", ") || "no shortcut"}. Change`
                  }
                  title="Click, then press the new keys · Backspace leaves it without one · Esc cancels"
                  onClick={() => setRecording(isRecording ? undefined : action.id)}
                >
                  {isRecording ? (
                    <Text fz="xs" c="accent.4">
                      Press keys…
                    </Text>
                  ) : keys.length ? (
                    <Group gap={4} wrap="nowrap">
                      {keys.map((k) => (
                        <Kbd key={k} size="xs">
                          {formatBinding(k)}
                        </Kbd>
                      ))}
                    </Group>
                  ) : (
                    <Text fz="xs" c="dimmed">
                      None
                    </Text>
                  )}
                </UnstyledButton>
              </Group>
            );
          })}
        </Stack>
      ))}
      <Group>
        <Button size="xs" variant="default" disabled={!changed} onClick={() => setOverrides({})}>
          Reset all shortcuts
        </Button>
      </Group>
    </Stack>
  );
};
