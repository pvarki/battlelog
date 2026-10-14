import type { MeApi } from "@server/routes/me/me.routes.ts";
import { hc } from "hono/client";
import { useEffect, useState } from "react";

const meApi = hc<MeApi>("/api/v1");

let cached: Promise<string | null> | undefined;

const fetchCallsign = async (): Promise<string | null> => {
  // Local dev has no mTLS proxy in front of the server to say who we are.
  if (import.meta.env.VITE_TAK_CALLSIGN) return import.meta.env.VITE_TAK_CALLSIGN;
  const res = await meApi.me.$get();
  if (!res.ok) throw new Error(`Failed to load identity (${res.status})`);
  return (await res.json()).callsign;
};

/** The callsign, fetched once per page; a failed fetch is retried on the next call. */
export const loadCallsign = (): Promise<string | null> => {
  cached ??= fetchCallsign().catch((err) => {
    cached = undefined;
    throw err;
  });
  return cached;
};

/** The user's callsign: the CN of the client certificate TAK also knows them by. */
export const useCallsign = (): string | null | undefined => {
  const [callsign, setCallsign] = useState<string | null>();
  useEffect(() => {
    let current = true;
    loadCallsign().then(
      (value) => current && setCallsign(value),
      () => current && setCallsign(null),
    );
    return () => {
      current = false;
    };
  }, []);
  return callsign;
};
