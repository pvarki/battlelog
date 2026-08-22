import type { Widget } from "../api.ts";

// Wall-display grid: fills the viewport exactly (no scrolling), sized for
// FullHD. Rows/cols are fixed; cell size derives from the available space.
// Shared, because anything drawing a dashboard's shape — the canvas itself and
// the list thumbnails — has to agree on what the shape is measured against.
export const GRID_COLS = 48;
export const GRID_ROWS = 24;
export const GRID_MARGIN = 8;

/** A widget's slot as percentages of the canvas, ready for absolute positioning. */
export type Block = {
  /** The widget's id — unique within a dashboard, so it doubles as a render key. */
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Widget slots as percentage boxes. Clamped to the grid: a layout stored by an
 * older build (or a hand-edited import) could name a slot wider than the canvas,
 * and a thumbnail must not paint outside its frame.
 */
export const layoutBlocks = (widgets: Widget[], cols = GRID_COLS, rows = GRID_ROWS): Block[] =>
  widgets.map(({ id, layout }) => {
    const x = Math.min(Math.max(layout.x, 0), cols);
    const y = Math.min(Math.max(layout.y, 0), rows);
    return {
      id,
      left: (x / cols) * 100,
      top: (y / rows) * 100,
      width: (Math.min(layout.w, cols - x) / cols) * 100,
      height: (Math.min(layout.h, rows - y) / rows) * 100,
    };
  });
