import { useEffect } from "react";

/**
 * Keep the screen awake while mounted — dashboards live on wall displays and
 * field tablets that must not dim mid-watch.
 */
export const useWakeLock = () => {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let alive = true;
    const acquire = () => {
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (alive) lock = l;
          else l.release();
        })
        .catch(() => {}); // denied (battery saver etc.) — the screen just dims
    };
    // The browser releases the lock whenever the tab is hidden; take it back
    // when the tab returns, or it silently stays off for the rest of the watch.
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release();
    };
  }, []);
};
