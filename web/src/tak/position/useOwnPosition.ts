import { type Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { Position } from "../cot.ts";
import { sendCot } from "../session.ts";
import {
  type Fix,
  IDLE_INTERVAL_MS,
  isSendDue,
  newSelfSaEvent,
  type SelfIdentity,
} from "./self-sa.ts";

const FOCUS_ZOOM = 14;

type BatteryNavigator = Navigator & { getBattery?: () => Promise<{ level: number }> };

const fixOf = ({ coords }: GeolocationPosition): Fix => ({
  position: [coords.longitude, coords.latitude],
  hae: coords.altitude ?? undefined,
  accuracy: coords.accuracy,
  altitudeAccuracy: coords.altitudeAccuracy ?? undefined,
  speed: coords.speed ?? undefined,
  // Browsers report NaN for a device standing still.
  course: Number.isFinite(coords.heading) ? (coords.heading as number) : undefined,
});

const batteryPercent = async () => {
  const battery = await (navigator as BatteryNavigator).getBattery?.().catch(() => undefined);
  return battery && Math.round(battery.level * 100);
};

/** ATAK's self marker: a navigation arrow pointing where the user is heading. */
const selfMarkerElement = () => {
  const el = document.createElement("div");
  el.className = "tak-self-marker";
  el.innerHTML =
    '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 2 20 21 12 16.5 4 21Z"/></svg>';
  return el;
};

/**
 * Where this browser is. Watched while the user shares it (then sent to TAK
 * as their position report) or asks to see it ("Locate me", kept local).
 * Nothing is sent while the page is hidden: the report then goes stale on
 * TAK, as a silent ATAK's does.
 */
export const useOwnPosition = (map: MapLibreMap | undefined, self: SelfIdentity | undefined) => {
  const [locating, setLocating] = useState(false);
  const [fix, setFix] = useState<Fix>();
  const [error, setError] = useState<string>();
  const flyPending = useRef(false);
  const lastSent = useRef<{ position: Position; time: number }>(undefined);
  const watching = !!self || locating;

  useEffect(() => {
    if (!watching) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setFix(fixOf(p));
        setError(undefined);
      },
      (e) => setError(e.message || "Location unavailable"),
      { enableHighAccuracy: true },
    );
    return () => {
      navigator.geolocation.clearWatch(id);
      setFix(undefined);
    };
  }, [watching]);

  useEffect(() => {
    if (!map || !fix) return;
    const marker = new Marker({ element: selfMarkerElement(), rotationAlignment: "map" })
      .setLngLat(fix.position)
      .setRotation(fix.course ?? 0)
      .addTo(map);
    if (flyPending.current) {
      flyPending.current = false;
      map.flyTo({ center: fix.position, zoom: Math.max(map.getZoom(), FOCUS_ZOOM) });
    }
    return () => {
      marker.remove();
    };
  }, [map, fix]);

  useEffect(() => {
    if (!self || !fix) return;
    // Sharing switched off (or a newer fix) while the battery was read: send nothing.
    let current = true;
    const send = async (force: boolean) => {
      const now = Date.now();
      if (document.hidden || (!force && !isSendDue(lastSent.current, fix.position, now))) return;
      const battery = await batteryPercent();
      if (!current || document.hidden) return;
      const event = newSelfSaEvent(fix, self, { os: navigator.platform, battery });
      if (sendCot(event)) lastSent.current = { position: fix.position, time: now };
    };
    void send(false);
    const heartbeat = setInterval(() => void send(true), IDLE_INTERVAL_MS);
    return () => {
      current = false;
      clearInterval(heartbeat);
    };
  }, [self, fix]);

  const flyToFix = (at: Position) =>
    map?.flyTo({ center: at, zoom: Math.max(map.getZoom(), FOCUS_ZOOM) });

  const toggleLocate = () => {
    if (!locating && fix) flyToFix(fix.position);
    else flyPending.current = !locating;
    setLocating(!locating);
  };

  return { fix, error, locating, toggleLocate };
};
