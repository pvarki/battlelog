type Rect = { x: number; y: number; w: number; h: number };

/**
 * First slot a `size`-shaped widget fits, scanned in reading order
 * (top-left to bottom-right), or null when the canvas has no room.
 *
 * The canvas is fixed at GRID_COLS x GRID_ROWS with no compaction, so the
 * search space is a constant (~1150 origins) and widget count is bounded by
 * what fits on one screen — this cannot degrade with usage. On a collision the
 * scan jumps x past the blocker's right edge rather than stepping by one: any
 * x before that edge still overlaps the same blocker, so nothing is skipped.
 *
 * ponytail: linear scan, recomputed per placement. If a drag-from-palette drop
 * preview ever calls this per pointer-move, switch to an occupancy bitmap.
 */
export const firstFreeSlot = (
  taken: Rect[],
  size: { w: number; h: number },
  cols: number,
  rows: number,
): { x: number; y: number } | null => {
  if (size.w > cols || size.h > rows) return null;
  for (let y = 0; y + size.h <= rows; y++) {
    let x = 0;
    while (x + size.w <= cols) {
      const blocker = taken.find(
        (t) => x < t.x + t.w && x + size.w > t.x && y < t.y + t.h && y + size.h > t.y,
      );
      if (!blocker) return { x, y };
      x = blocker.x + blocker.w;
    }
  }
  return null;
};
