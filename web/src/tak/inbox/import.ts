import { strFromU8 } from "fflate";
import { useSyncExternalStore } from "react";
import { toChange } from "../cot.ts";
import { MAX_PACKAGE_BYTES, planFromEvents, unzipLimited } from "../plans/plans.ts";
import { parseCotXml } from "../protocol/cot-xml.ts";
import {
  contentUrl,
  readCapped,
  TakRequestError,
  type TakWrite,
  takGetText,
  takSend,
} from "../rest.ts";
import { type PackageRef, readPackage, sha256Hex } from "./fileshare.ts";

/** A received file, kept as a blob URL for this tab's lifetime. */
export type ReceivedFile = { name: string; url: string };

/** What importing a package made: a plan of its map items, and its loose files to save. */
export type Imported = { planId?: string; attached: number; files: ReceivedFile[] };

/** Memory only: files tied to map items (by uid) and what each package (by hash) gave. */
let attachments = new Map<string, ReceivedFile[]>();
let imported = new Map<string, Imported>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const NONE: ReceivedFile[] = [];

export const useAttachments = (uid: string): ReceivedFile[] =>
  useSyncExternalStore(subscribe, () => attachments.get(uid) ?? NONE);

export const useImported = (hash: string): Imported | undefined =>
  useSyncExternalStore(subscribe, () => imported.get(hash));

const IMAGE = /\.(jpe?g|png|gif|webp|bmp)$/i;
export const isImage = (name: string) => IMAGE.test(name);

const toFile = ({ name, bytes }: { name: string; bytes: Uint8Array }): ReceivedFile => ({
  name,
  url: URL.createObjectURL(new Blob([bytes.slice()])),
});

const tooLarge = () => new Error("Package is too large to import");

/** Downloads a package from our TAK Server, checks it is the one announced and unpacks it. */
export const importPackage = async (ref: PackageRef): Promise<Imported> => {
  if (ref.size > MAX_PACKAGE_BYTES) throw tooLarge();
  const res = await fetch(contentUrl(ref.hash), { credentials: "include" });
  if (!res.ok) throw new TakRequestError("/Marti/sync/content", res.status);
  if (Number(res.headers.get("Content-Length")) > MAX_PACKAGE_BYTES) throw tooLarge();
  const zip = await readCapped(res, MAX_PACKAGE_BYTES, tooLarge);
  if ((await sha256Hex(zip)) !== ref.hash.toLowerCase())
    throw new Error("Package doesn't match its announced hash");
  const contents = readPackage(unzipLimited(zip, () => true, MAX_PACKAGE_BYTES));
  const events = contents.cot
    .flatMap((file) => parseCotXml(strFromU8(file.bytes)))
    .filter((event) => toChange(event)?.kind === "upsert");
  const plan =
    events.length > 0
      ? planFromEvents(contents.name ?? ref.name.replace(/\.zip$/i, ""), events)
      : undefined;
  attachments = new Map(attachments);
  for (const file of contents.attachments) {
    attachments.set(file.uid, [...(attachments.get(file.uid) ?? []), toFile(file)]);
  }
  const result = {
    planId: plan?.id,
    attached: contents.attachments.length,
    files: contents.other.map(toFile),
  };
  imported = new Map(imported).set(ref.hash, result);
  notify();
  return result;
};

type SyncSearch = {
  results?: {
    Hash?: string;
    Name?: string;
    Size?: string;
    SubmissionUser?: string;
    SubmissionDateTime?: string;
    CreatorUid?: string;
  }[];
};

export type TakPackage = PackageRef & {
  /** The TAK user (certificate name) who uploaded it. */
  by: string;
  submitted: string;
  /** The client uid the uploader named, e.g. BattleLog's or their ATAK's. */
  creatorUid: string;
};

/** Data packages users have put on TAK Server, newest first. */
export const fetchTakPackages = async (signal?: AbortSignal): Promise<TakPackage[]> => {
  const text = await takGetText("/Marti/sync/search?keywords=missionpackage", signal);
  const { results = [] } = (text ? JSON.parse(text) : {}) as SyncSearch;
  return results
    .flatMap((r) =>
      r.Hash && r.Name
        ? [
            {
              hash: r.Hash,
              name: r.Name,
              size: Number(r.Size) || 0,
              by: r.SubmissionUser ?? "",
              submitted: r.SubmissionDateTime ?? "",
              creatorUid: r.CreatorUid ?? "",
            },
          ]
        : [],
    )
    .sort((a, b) => b.submitted.localeCompare(a.submitted));
};

/**
 * TAK lets anyone sharing a group delete a package, so BattleLog offers it
 * only for packages this user uploaded. Only the submitter, which TAK takes from
 * the certificate, counts: the creator uid is whatever the uploader claimed.
 */
export const isOwnPackage = (pkg: TakPackage, callsign: string | null | undefined) =>
  !!callsign && pkg.by === callsign;

export const deletePackageRequest = (hash: string): TakWrite => ({
  method: "DELETE",
  path: `/Marti/api/files/${encodeURIComponent(hash)}`,
});

export const syncDeleteRequest = (hash: string): TakWrite => ({
  method: "POST",
  path: `/Marti/sync/delete?${new URLSearchParams({ Hash: hash })}`,
});

/** Deletes the package from TAK; resolves to the packages left, which no longer list it. */
export const deleteTakPackage = async (hash: string): Promise<TakPackage[]> => {
  await takSend(deletePackageRequest(hash)).catch((err: unknown) => {
    // A TAK without the files API answers 404 or 405; the sync API is ATAK's own.
    if (err instanceof TakRequestError && (err.status === 404 || err.status === 405))
      return takSend(syncDeleteRequest(hash));
    throw err;
  });
  const left = await fetchTakPackages();
  if (left.some((p) => p.hash === hash)) throw new Error("TAK didn't confirm the deletion");
  return left;
};
