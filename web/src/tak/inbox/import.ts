import { strFromU8 } from "fflate";
import { useSyncExternalStore } from "react";
import { toChange } from "../cot.ts";
import { MAX_PACKAGE_BYTES, planFromEvents, unzipLimited } from "../plans/plans.ts";
import { parseCotXml } from "../protocol/cot-xml.ts";
import { contentUrl, readCapped, TakRequestError, takGetText } from "../rest.ts";
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
  }[];
};

export type TakPackage = PackageRef & { by: string; submitted: string };

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
            },
          ]
        : [],
    )
    .sort((a, b) => b.submitted.localeCompare(a.submitted));
};
