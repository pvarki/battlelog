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
    const reacquire = () => {
      if (alive && document.visibilityState === "visible") acquire();
    };
    const acquire = () => {
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (!alive) {
            l.release();
            return;
          }
          lock = l;
          l.addEventListener("release", reacquire);
        })
        .catch((err: unknown) => {
          console.debug("Screen wake lock unavailable", err);
        });
    };
    // The browser also releases the lock whenever the tab is hidden; the same
    // reacquire brings it back when the tab returns.
    acquire();
    document.addEventListener("visibilitychange", reacquire);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", reacquire);
      lock?.release();
    };
  }, []);
};
