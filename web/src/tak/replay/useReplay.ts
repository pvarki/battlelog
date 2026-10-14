import { useEffect, useState } from "react";
import { takStore } from "../session.ts";
import { loadReplayChanges } from "./archive.ts";
import { createReplay, type Replay, type ReplayFrame } from "./replay.ts";

const TICK_MS = 250;
export const DEFAULT_REPLAY_WINDOW_MS = 2 * 60 * 60 * 1000;

type Loaded = { start: number; end: number; replay: Replay };

/**
 * Replay mode: the last `windowMs` of TAK's archive played back over a time
 * slider. The live session keeps running underneath, so leaving replay shows
 * the live picture as it is by then.
 */
export const useReplay = () => {
  const [windowMs, setWindowMs] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>();
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(false);
  const [frame, setFrame] = useState<ReplayFrame>();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is how a retry asks to load again.
  useEffect(() => {
    setLoaded(undefined);
    setFrame(undefined);
    setPlaying(false);
    setError(false);
    setProgress(0);
    if (windowMs === undefined) return;
    const abort = new AbortController();
    const end = Date.now();
    loadReplayChanges(end - windowMs, end, abort.signal, setProgress).then(
      ({ changes, from }) => {
        if (abort.signal.aborted) return;
        const start = Math.max(end - windowMs, from);
        // Items unchanged since before the window are as they stood all through it.
        const seed = takStore.getSnapshot().filter((item) => item.time < start);
        const replay = createReplay(changes, seed);
        setLoaded({ start, end, replay });
        setFrame(replay.at(start));
      },
      (err) => {
        if (abort.signal.aborted) return;
        console.warn("TAK replay history failed", err);
        setError(true);
      },
    );
    return () => abort.abort();
  }, [windowMs, attempt]);

  useEffect(() => {
    if (!playing || !loaded || !frame) return;
    const timer = setTimeout(() => {
      const at = Math.min(frame.at + TICK_MS * speed, loaded.end);
      setFrame(loaded.replay.at(at));
      if (at >= loaded.end) setPlaying(false);
    }, TICK_MS);
    return () => clearTimeout(timer);
  }, [playing, loaded, frame, speed]);

  const seek = (at: number) => {
    if (loaded) setFrame(loaded.replay.at(at));
  };

  return {
    /** Undefined while live. */
    windowMs,
    setWindowMs,
    stop: () => setWindowMs(undefined),
    retry: () => setAttempt((n) => n + 1),
    /** Share of the archive fetched while loading, 0–1. */
    progress,
    error,
    /** The window replayed; starts later than asked when the change limit cut it. */
    span: loaded && { start: loaded.start, end: loaded.end },
    frame,
    seek,
    playing,
    togglePlay: () => {
      if (!playing && loaded && frame && frame.at >= loaded.end) seek(loaded.start);
      setPlaying(!playing);
    },
    speed,
    setSpeed,
  };
};

export type ReplayControls = ReturnType<typeof useReplay>;
