import { z } from "zod";
import { type TakItem, toChange } from "../cot.ts";
import {
  fetchLatestCot,
  parseCotXmlInSlices,
  TakRequestError,
  takBaseUrl,
  takGetText,
} from "../rest.ts";
import { inSlices } from "../slices.ts";

/** TAK missions (ATAK's Data Sync): shared folders of map items, files and a log. */

export type MissionFile = {
  uid: string;
  name: string;
  hash: string;
  size: number;
  submitter?: string;
  keywords: string[];
  time: number;
};

export const MISSION_ROLES = [
  "MISSION_OWNER",
  "MISSION_SUBSCRIBER",
  "MISSION_READONLY_SUBSCRIBER",
] as const;
export type MissionRole = (typeof MISSION_ROLES)[number];

export const ROLE_LABELS: Record<MissionRole, string> = {
  MISSION_OWNER: "Owner",
  MISSION_SUBSCRIBER: "Subscriber",
  MISSION_READONLY_SUBSCRIBER: "Read-only",
};

/** TAK sends a role as `{ type, permissions }`; an unknown one reads as undefined. */
const roleSchema = z
  .union([z.string(), z.object({ type: z.string() }).transform((r) => r.type)])
  .optional()
  .catch(undefined)
  .transform((type) => MISSION_ROLES.find((role) => role === type));

/** A basemap or overlay a feed carries for its subscribers' maps. */
export type MissionMapLayer = { name: string; type?: string; url?: string };

export type Mission = {
  name: string;
  description?: string;
  creatorUid?: string;
  createTime: number;
  keywords: string[];
  /** Listed, but TAK refuses its contents to non-subscribers. */
  passwordProtected: boolean;
  /** Hidden from TAK's list; only invited users see it. */
  inviteOnly: boolean;
  /** The role a new subscriber gets. */
  defaultRole?: MissionRole;
  itemUids: string[];
  files: MissionFile[];
  /** Newest change to its items or files. */
  changedAt: number;
  /** Moves whenever items or files are added or removed; contents are refetched only then. */
  version: string;
  mapLayers: MissionMapLayer[];
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
  defaultRole: roleSchema,
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
          keywords: z.array(z.string()).catch([]),
        }),
      }),
    )
    .catch([]),
  mapLayers: z.array(z.object({ name: z.string(), type: text, url: text })).catch([]),
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
        passwordProtected: m.passwordProtected,
        inviteOnly: m.inviteOnly,
        defaultRole: m.defaultRole,
        itemUids: m.uids.map((u) => u.data),
        files: m.contents.map((c) => ({ ...c.data, time: c.timestamp })),
        changedAt: Math.max(m.createTime, ...changes),
        // A removal doesn't move the newest timestamp, but it changes the counts.
        version: `${m.uids.length}:${m.contents.length}:${Math.max(0, ...changes)}`,
        mapLayers: m.mapLayers,
      },
    ];
  });
};

export const missionPath = (name: string) => `/Marti/api/missions/${encodeURIComponent(name)}`;

const getJson = async (path: string, signal?: AbortSignal): Promise<unknown> =>
  JSON.parse((await takGetText(path, signal)) || "{}");

export const fetchMissions = async (signal?: AbortSignal) =>
  parseMissionList(await getJson("/Marti/api/missions", signal));

/** One mission by name, e.g. an invite-only one TAK leaves out of its list; undefined when refused or gone. */
export const fetchMission = async (name: string): Promise<Mission | undefined> => {
  try {
    return parseMissionList(await getJson(missionPath(name)))[0];
  } catch (err) {
    if (isAccessDenied(err)) return undefined;
    throw err;
  }
};

export type MissionMember = { clientUid: string; username?: string; role?: MissionRole };

const memberSchema = z.object({ clientUid: z.string().min(1), username: text, role: roleSchema });

/** Subscribers with their roles, from `GET /Marti/api/missions/{name}/subscriptions/roles`. */
export const parseMembers = (json: unknown): MissionMember[] => {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw) => {
    const parsed = memberSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
};

export const fetchMembers = async (name: string, signal?: AbortSignal) =>
  parseMembers(await getJson(`${missionPath(name)}/subscriptions/roles`, signal));

export const INVITEE_TYPES = ["callsign", "clientUid", "group"] as const;
export type InviteeType = (typeof INVITEE_TYPES)[number];

export type MissionInvitation = { type: InviteeType; invitee: string; role?: MissionRole };

const invitationSchema = z.object({
  type: z.enum(INVITEE_TYPES),
  invitee: z.string().min(1),
  role: roleSchema,
});

/** A mission's open invitations; the per-invitee tokens TAK includes are dropped. */
export const parseInvitations = (json: unknown): MissionInvitation[] => {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((raw) => {
    const parsed = invitationSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
};

export const fetchInvitations = async (name: string, signal?: AbortSignal) =>
  parseInvitations(await getJson(`${missionPath(name)}/invitations`, signal));

/** Names of the missions `clientUid` is invited to: TAK answers names, or invitations naming their mission. */
export const parseInvitedMissions = (json: unknown): string[] => {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const names = data.map((entry) =>
    typeof entry === "string" ? entry : (entry as { missionName?: unknown })?.missionName,
  );
  return [...new Set(names.filter((n): n is string => typeof n === "string" && !!n))];
};

export const fetchInvitedMissions = async (clientUid: string, signal?: AbortSignal) =>
  parseInvitedMissions(
    await getJson(`/Marti/api/missions/invitations?${new URLSearchParams({ clientUid })}`, signal),
  );

// Anyone who can write to a mission can fill it; past this it would crowd out the live picture.
const MAX_MISSION_ITEMS = 20_000;

/** The mission's map items; TAK refuses (403) restricted missions we're not part of. */
export const fetchMissionItems = async (name: string, signal?: AbortSignal): Promise<TakItem[]> => {
  const events = await parseCotXmlInSlices(await takGetText(`${missionPath(name)}/cot`, signal));
  if (events.length > MAX_MISSION_ITEMS)
    throw new Error(`Mission ${name} has over 20,000 items, too many to show`);
  const items: TakItem[] = [];
  await inSlices(
    events,
    (slice) => {
      for (const event of slice) {
        const change = toChange(event);
        if (change?.kind === "upsert") items.push(change.item);
      }
    },
    signal,
  );
  return items;
};

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
  const data = ((await getJson(`${missionPath(name)}/log`, signal)) as { data?: unknown })?.data;
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

/** A feed's layer tree (groups of items, files and map layers), flattened with each entry's depth. */
export type MissionLayer = { uid: string; name: string; type?: string; depth: number };

type RawLayer = { uid?: unknown; name?: unknown; type?: unknown; children?: unknown };

/** The layers from `GET /Marti/api/missions/{name}/layers`, each parent before its children. */
export const parseMissionLayers = (json: unknown): MissionLayer[] => {
  const flatten = (raw: unknown, depth: number): MissionLayer[] =>
    Array.isArray(raw)
      ? raw.flatMap((layer: RawLayer) =>
          typeof layer?.uid === "string"
            ? [
                {
                  uid: layer.uid,
                  name: typeof layer.name === "string" && layer.name ? layer.name : layer.uid,
                  type: typeof layer.type === "string" ? layer.type : undefined,
                  depth,
                },
                ...flatten(layer.children, depth + 1),
              ]
            : [],
        )
      : [];
  return flatten((json as { data?: unknown })?.data, 0);
};

export const fetchMissionLayers = async (name: string, signal?: AbortSignal) =>
  parseMissionLayers(await getJson(`${missionPath(name)}/layers`, signal));

export type MissionExport = "kml" | "archive";

export const exportPath = (name: string, kind: MissionExport) =>
  kind === "kml" ? `${missionPath(name)}/kml?download=true` : `${missionPath(name)}/archive`;

/** The feed as KML or as TAK's zip archive; any reader may export. */
export const fetchMissionExport = async (name: string, kind: MissionExport): Promise<Blob> => {
  const path = exportPath(name, kind);
  const res = await fetch(`${takBaseUrl()}${path}`, { credentials: "include" });
  if (!res.ok) throw new TakRequestError(path.split("?")[0] as string, res.status);
  return res.blob();
};

/** Where the browser downloads a mission file, with the user's own certificate. */
export const fileUrl = (file: MissionFile) =>
  `${takBaseUrl()}/Marti/sync/content?hash=${encodeURIComponent(file.hash)}`;
