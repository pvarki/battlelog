import { zipSync } from "fflate";
import type { CotEvent, TakItem } from "./cot.ts";
import type { Sender } from "./drawing/new-items.ts";
import { FILE_SHARE_TYPE, sha256Hex } from "./inbox/fileshare.ts";
import { labelOf } from "./items.ts";
import { safeZipName } from "./plans/plans.ts";
import { publicContentUrl, TakRequestError, takBaseUrl } from "./rest.ts";
import { sendCot } from "./session.ts";

/**
 * Photos delivered the way ATAK sends attachments: a data package holding the
 * file tied to the marker's uid, uploaded to TAK Server and announced with a
 * file-share CoT. Receiving ATAKs download it without asking and file the
 * photo under that marker's attachments. The marker's own CoT is left out of
 * the package, so a receiver's newer copy of the marker isn't overwritten.
 */

const ANNOUNCE_STALE_MS = 100_000;
const UNKNOWN = 9_999_999;

const escapeXml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** The package's manifest; ATAK needs both uid and callsign to file and announce the photo. */
export const attachmentManifest = (item: TakItem, fileName: string, zipEntry: string) => {
  const param = (name: string, value: string) =>
    `<Parameter name="${name}" value="${escapeXml(value)}"/>`;
  return `<MissionPackageManifest version="2"><Configuration>${param("uid", item.uid)}${param("name", fileName)}${param("onReceiveImport", "true")}${param("onReceiveDelete", "true")}${param("onReceiveAction", "com.atakmap.android.attachment.ATTACHMENT_RECEIVED")}${param("callsign", labelOf(item))}</Configuration><Contents><Content ignore="false" zipEntry="${escapeXml(zipEntry)}">${param("uid", item.uid)}</Content></Contents></MissionPackageManifest>`;
};

export const attachmentPackage = (
  item: TakItem,
  fileName: string,
  photo: Uint8Array,
): Uint8Array => {
  // ATAK files the photo under its name alone, so the directory only has to be unique.
  const zipEntry = `${crypto.randomUUID()}/${safeZipName(fileName)}`;
  const manifest = new TextEncoder().encode(attachmentManifest(item, fileName, zipEntry));
  return zipSync({ "MANIFEST/manifest.xml": manifest, [zipEntry]: photo }, { level: 0 });
};

/** The file-share announcement; no recipients means every TAK user in the sender's groups. */
export const fileShareEvent = (
  share: { fileName: string; hash: string; size: number; name: string },
  sender: Sender,
  recipients: string[],
  now = Date.now(),
): CotEvent => {
  const dest = recipients.map((callsign) => `<dest callsign="${escapeXml(callsign)}"/>`).join("");
  return {
    uid: crypto.randomUUID(),
    type: FILE_SHARE_TYPE,
    how: "h-e",
    time: now,
    start: now,
    stale: now + ANNOUNCE_STALE_MS,
    lat: 0,
    lon: 0,
    hae: UNKNOWN,
    ce: UNKNOWN,
    le: UNKNOWN,
    access: "Undefined",
    detail: `<fileshare filename="${escapeXml(share.fileName)}" senderUrl="${escapeXml(publicContentUrl(share.hash))}" sizeInBytes="${share.size}" sha256="${share.hash}" senderUid="${escapeXml(sender.uid)}" senderCallsign="${escapeXml(sender.callsign)}" name="${escapeXml(share.name)}"/>${dest ? `<marti>${dest}</marti>` : ""}`,
  };
};

/**
 * Uploads a data package to TAK and announces it to `recipients` (callsigns;
 * empty = everyone), the way ATAK sends a package to chosen contacts.
 */
export const sendDataPackage = async (
  zip: Uint8Array<ArrayBuffer>,
  zipName: string,
  name: string,
  sender: Sender,
  recipients: string[],
) => {
  const hash = await sha256Hex(zip);
  const form = new FormData();
  form.append("assetfile", new Blob([zip], { type: "application/x-zip-compressed" }), zipName);
  const query = new URLSearchParams({ hash, filename: zipName, creatorUid: sender.uid });
  const res = await fetch(`${takBaseUrl()}/Marti/sync/missionupload?${query}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (!res.ok) throw new TakRequestError("/Marti/sync/missionupload", res.status);
  const announcement = fileShareEvent(
    { fileName: zipName, hash, size: zip.length, name },
    sender,
    recipients,
  );
  if (!sendCot(announcement)) throw new Error("Not connected to TAK");
};

/** Packages the photo for the item, uploads it and announces it to `recipients` (callsigns; empty = everyone). */
export const sendPhotoPackage = async (
  item: TakItem,
  photo: File,
  callsign: string,
  recipients: string[],
) => {
  const fileName = photo.name || "photo.jpg";
  const zip = attachmentPackage(item, fileName, new Uint8Array(await photo.arrayBuffer()));
  await sendDataPackage(
    zip.slice(),
    `${fileName.replace(/\.[^.]*$/, "")}.zip`,
    `${labelOf(item)}: ${fileName}`,
    { uid: `BattleLog-${callsign}`, callsign },
    recipients,
  );
};
