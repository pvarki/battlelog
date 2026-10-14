import { z } from "zod";
import { type TakItem, toChange } from "../cot.ts";
import { parseCotXml } from "../protocol/cot-xml.ts";
import { fetchLatestCot, TakRequestError, takBaseUrl, takGetText } from "../rest.ts";

/** TAK missions (ATAK's Data Sync): shared folders of map items, files and a log. */

export type MissionFile = {
  uid: string;
  name: string;
  hash: string;
  size: number;
  submitter?: string;
  time: number;
};

export type Mission = {
  name: string;
  description?: string;
  creatorUid?: string;
  createTime: number;
  keywords: string[];
  /** Password-protected or invite-only: listed, but its contents may be refused. */
  restricted: boolean;
  itemUids: string[];
  files: MissionFile[];
  /** Newest change to its items or files. */
  changedAt: number;
  /** Moves whenever items or files are added or removed; contents are refetched only then. */
  version: string;
};

export type MissionLogEntry = { id: string; content: string; creatorUid?: string; time: number };

const time = z
  .string()
  .optional()
  .transform((s) => (s ? Date.parse(s) || 0 : 0));
const text = z
  .string()
  .optional()
  .transform((s) => s || undefined);

const missionSchema = z.object({
  name: z.string().min(1),
  description: text,
  creatorUid: text,
  createTime: time,
  keywords: z.array(z.string()).catch([]),
  passwordProtected: z.boolean().catch(false),
  inviteOnly: z.boolean().catch(false),
  uids: z.array(z.object({ data: z.string(), timestamp: time })).catch([]),
  contents: z
    .array(
      z.object({
        timestamp: time,
        data: z.object({
          uid: z.string(),
          name: z.string(),
          hash: z.string(),
          size: z.number().catch(0),
          submitter: text,
        }),
      }),
    )
    .catch([]),
});

/** Missions from `GET /Marti/api/missions`; malformed entries are skipped, not fatal. */
export const parseMissionList = (json: unknown): Mission[] => {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw) => {
    const parsed = missionSchema.safeParse(raw);
    if (!parsed.success) return [];
    const m = parsed.data;
    const changes = [...m.uids.map((u) => u.timestamp), ...m.contents.map((c) => c.timestamp)];
    return [
      {
        name: m.name,
        description: m.description,
        creatorUid: m.creatorUid,
        createTime: m.createTime,
        keywords: m.keywords,
        restricted: m.passwordProtected || m.inviteOnly,
        itemUids: m.uids.map((u) => u.data),
        files: m.contents.map((c) => ({ ...c.data, time: c.timestamp })),
        changedAt: Math.max(m.createTime, ...changes),
        // A removal doesn't move the newest timestamp, but it changes the counts.
        version: `${m.uids.length}:${m.contents.length}:${Math.max(0, ...changes)}`,
      },
    ];
  });
};

export const missionPath = (name: string) => `/Marti/api/missions/${encodeURIComponent(name)}`;

export const fetchMissions = async (signal?: AbortSignal) =>
  parseMissionList(JSON.parse((await takGetText("/Marti/api/missions", signal)) || "{}"));

/** The mission's map items; TAK refuses (403) restricted missions we're not part of. */
export const fetchMissionItems = async (name: string, signal?: AbortSignal): Promise<TakItem[]> =>
  parseCotXml(await takGetText(`${missionPath(name)}/cot`, signal)).flatMap((event) => {
    const change = toChange(event);
    return change?.kind === "upsert" ? [change.item] : [];
  });

/** One mission item as TAK now has it; undefined when TAK has no map item for the uid. */
export const fetchMissionItem = async (uid: string): Promise<TakItem | undefined> => {
  const event = await fetchLatestCot(uid);
  const change = event && toChange(event);
  return change?.kind === "upsert" ? change.item : undefined;
};

const logSchema = z.object({
  id: z.string(),
  content: z.string().catch(""),
  creatorUid: text,
  dtg: time,
});

export const fetchMissionLog = async (
  name: string,
  signal?: AbortSignal,
): Promise<MissionLogEntry[]> => {
  const data = (
    JSON.parse((await takGetText(`${missionPath(name)}/log`, signal)) || "{}") as { data?: unknown }
  ).data;
  if (!Array.isArray(data)) return [];
  return data
    .flatMap((raw) => {
      const parsed = logSchema.safeParse(raw);
      return parsed.success ? [{ ...parsed.data, time: parsed.data.dtg }] : [];
    })
    .sort((a, b) => b.time - a.time);
};

export const isAccessDenied = (err: unknown) =>
  err instanceof TakRequestError && (err.status === 401 || err.status === 403);

/** Where the browser downloads a mission file, with the user's own certificate. */
export const fileUrl = (file: MissionFile) =>
  `${takBaseUrl()}/Marti/sync/content?hash=${encodeURIComponent(file.hash)}`;
