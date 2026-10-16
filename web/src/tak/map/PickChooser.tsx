import { Paper, Text, UnstyledButton } from "@mantine/core";
import { useEffect, useRef } from "react";
import type { TakItem } from "../cot.ts";
import { describeType, labelOf } from "../items.ts";

type Props = {
  items: TakItem[];
  at: { x: number; y: number };
  onPick: (item: TakItem) => void;
  onClose: () => void;
};

/** Which of the overlapping items a click meant, like ATAK asks; topmost first. */
export const PickChooser = ({ items, at, onPick, onClose }: Props) => {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <Paper
      className="tak-chooser"
      shadow="md"
      withBorder
      // Kept inside the map: a tap near its edge would otherwise push the choices off screen.
      style={{
        left: `clamp(0px, ${at.x}px, calc(100% - 256px))`,
        top: `clamp(0px, ${at.y}px, calc(100% - 336px))`,
      }}
      role="menu"
      aria-label="Items here"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <Text fz="xs" c="dimmed" px={8} pt={6}>
        {items.length} items here
      </Text>
      {items.map((item, i) => (
        <UnstyledButton
          key={item.uid}
          ref={i === 0 ? first : undefined}
          className="tak-row"
          role="menuitem"
          onClick={() => onPick(item)}
        >
          <Text fz="sm" fw={500} truncate>
            {labelOf(item)}
          </Text>
          <Text fz="xs" c="dimmed" truncate>
            {describeType(item)}
          </Text>
        </UnstyledButton>
      ))}
    </Paper>
  );
};
