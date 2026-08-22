import { Box } from "@mantine/core";
import type { Widget } from "../api.ts";
import { GRID_COLS, GRID_ROWS, layoutBlocks } from "./grid.ts";

/**
 * A dashboard's shape at a glance. "4 widgets" says nothing about which board
 * you are looking at; the silhouette says *the three-panel one with the wide
 * feed along the bottom*, which is how people actually recognise their own.
 *
 * Deliberately monochrome: widget type is not encoded, because nine types would
 * need nine colours and colour alone is not allowed to carry meaning here. The
 * adjacent row already states the widget count in words, so this is decorative
 * duplication for assistive tech and hidden from it.
 */
export const LayoutThumbnail = ({ widgets, w = 72 }: { widgets: Widget[]; w?: number }) => (
  <Box
    aria-hidden
    w={w}
    h={(w * GRID_ROWS) / GRID_COLS}
    bg="dark.8"
    style={{
      position: "relative",
      flexShrink: 0,
      borderRadius: 2,
      border: "1px solid var(--mantine-color-dark-5)",
      overflow: "hidden",
    }}
  >
    {layoutBlocks(widgets).map((b) => (
      <Box
        key={b.id}
        bg="dark.3"
        style={{
          position: "absolute",
          left: `${b.left}%`,
          top: `${b.top}%`,
          width: `${b.width}%`,
          height: `${b.height}%`,
          // Inset stands in for the canvas margin, so neighbours read as separate.
          outline: "1px solid var(--mantine-color-dark-8)",
          outlineOffset: -1,
        }}
      />
    ))}
  </Box>
);
