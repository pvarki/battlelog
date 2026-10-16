import { strFromU8 } from "fflate";
import { useEffect, useSyncExternalStore } from "react";
import { MAX_PACKAGE_BYTES, unzipLimited } from "../plans/plans.ts";
import { readCapped, TakRequestError, takBaseUrl, takGetText } from "../rest.ts";
import { useTakStatus } from "../session.ts";
import type { MapSource } from "./basemaps.ts";
import { parseAtakMapSource, sourceFromFields, toMapSource } from "./custom-sources.ts";

/**
 * Maps TAK Server hands its users: the server-wide map layers and the map
 * source files in the device profile TAK keeps for this client. Read-only,
 * fetched again on every connect, and kept for this tab only.
 */

/** One of TAK Server's `/Marti/api/maplayers` entries; only what we read. */
export type TakMapLayer = { uid: string; type?: string; enabled?: boolean } & Record<
  string,
  unknown
>;

const field = (layer: TakMapLayer) => (name: string) => {
  const value = layer[name];
  return value === null || value === undefined ? undefined : String(value).trim() || undefined;
};

const unsupported = (what: string, err: unknown) =>
  console.warn(`TAK map source ${what} can't be shown`, err);

export const mapLayerSources = (layers: TakMapLayer[]): MapSource[] =>
  layers.flatMap((layer) => {
    if (layer.enabled === false) return [];
    try {
      const wms = layer.type?.toUpperCase() === "WMS";
      return [toMapSource(sourceFromFields(field(layer), wms, `tak:layer:${layer.uid}`), "tak")];
    } catch (err) {
      unsupported(String(layer.name ?? layer.uid), err);
      return [];
    }
  });

const MAP_SOURCE_XML = /<custom(Wms)?MapSource\b/;

/** The map sources in a device profile, a data package of preference and other files. */
export const profileSources = (zip: Uint8Array): MapSource[] => {
  const files = unzipLimited(zip, (path) => path.toLowerCase().endsWith(".xml"), MAX_PACKAGE_BYTES);
  return Object.entries(files).flatMap(([path, bytes]) => {
    const xml = strFromU8(bytes);
    if (!MAP_SOURCE_XML.test(xml)) return [];
    try {
      return [toMapSource(parseAtakMapSource(xml, `tak:profile:${path}`), "tak")];
    } catch (err) {
      unsupported(path, err);
      return [];
    }
  });
};

const fetchMapLayers = async (): Promise<MapSource[]> => {
  const json = await takGetText("/Marti/api/maplayers/all");
  return json ? mapLayerSources((JSON.parse(json) as { data?: TakMapLayer[] }).data ?? []) : [];
};

const fetchProfileSources = async (clientUid: string): Promise<MapSource[]> => {
  const query = new URLSearchParams({ syncSecago: "-1", clientUid });
  const path = "/Marti/api/device/profile/connection";
  const res = await fetch(`${takBaseUrl()}${path}?${query}`, { credentials: "include" });
  if (res.status === 204 || res.status === 404) return [];
  if (!res.ok) throw new TakRequestError(path, res.status);
  const tooLarge = () => new Error("Device profile is too large");
  return profileSources(await readCapped(res, MAX_PACKAGE_BYTES, tooLarge));
};

let sources: MapSource[] = [];
const listeners = new Set<() => void>();

let refreshing = false;

/** A failed fetch keeps what it gave last time rather than dropping a map in use. */
const lastGood = (prefix: string) => (err: unknown) => {
  console.warn("TAK map sources failed to load", err);
  return sources.filter((s) => s.id.startsWith(prefix));
};

const refresh = async (clientUid: string) => {
  const [layers, profile] = await Promise.all([
    fetchMapLayers().catch(lastGood("tak:layer:")),
    fetchProfileSources(clientUid).catch(lastGood("tak:profile:")),
  ]);
  sources = [...layers, ...profile].sort((a, b) => a.label.localeCompare(b.label));
  for (const listener of listeners) listener();
};

/** Every map on screen asks on connect; one fetch answers them all. */
const refreshOnce = (clientUid: string) => {
  if (refreshing) return;
  refreshing = true;
  void refresh(clientUid).finally(() => {
    refreshing = false;
  });
};

/** TAK's maps for this client, fetched whenever the connection comes up. */
export const useTakMapSources = (clientUid: string | undefined): MapSource[] => {
  const live = useTakStatus().connection === "live";
  useEffect(() => {
    if (live && clientUid) refreshOnce(clientUid);
  }, [live, clientUid]);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => sources,
  );
};
