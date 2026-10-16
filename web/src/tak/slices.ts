/**
 * A day of TAK history is thousands of events; parsing or applying them in one
 * go blocks the page for seconds. Done a slice at a time, with the browser
 * free to handle input and draw in between, the map stays usable while it loads.
 */
export const SLICE_SIZE = 200;

/** Lets the browser handle input and draw before the next slice. */
export const yieldToMain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Calls `work` on consecutive slices of `list`, yielding between them; stops once `signal` aborts. */
export const inSlices = async <T>(
  list: readonly T[],
  work: (slice: readonly T[]) => void,
  signal?: AbortSignal,
  size = SLICE_SIZE,
) => {
  for (let i = 0; i < list.length; i += size) {
    if (i > 0) await yieldToMain();
    if (signal?.aborted) return;
    work(list.slice(i, i + size));
  }
};
