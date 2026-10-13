import { useEffect, useState } from "react";

/** The current time, re-read every `intervalMs`: staleness changes even when no data arrives. */
export const useNow = (intervalMs: number): number => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};
