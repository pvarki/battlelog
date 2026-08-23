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
          // The browser also releases on its own — low battery, power-save
          // mode — with no visibilitychange. Without listening to the sentinel
          // itself, the lock would silently stay off for the rest of the
          // watch. Retry is self-limiting: while power-save holds, request()
          // just rejects below.
          l.addEventListener("release", reacquire);
        })
        .catch((err: unknown) => {
          // Denied (battery saver etc.) — the screen just dims, but leave a
          // trace so a dimming wall display is diagnosable in the field.
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
