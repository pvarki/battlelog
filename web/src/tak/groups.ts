import { type TakWrite, takGetText, takSend } from "./rest.ts";

/**
 * TAK groups ("channels" in CloudTAK): the user's certificate puts them in
 * groups, and TAK delivers and accepts CoT only through the active ones. TAK
 * lists a group once per direction: IN carries what this client sends, OUT
 * what it receives.
 */

export type TakGroup = {
  name: string;
  direction: "IN" | "OUT";
  active: boolean;
  description?: string;
};

const isGroup = (value: unknown): value is TakGroup => {
  const group = value as Partial<TakGroup> | null;
  return (
    typeof group?.name === "string" &&
    (group.direction === "IN" || group.direction === "OUT") &&
    typeof group.active === "boolean"
  );
};

/** The groups from `GET /Marti/api/groups/all`; TAK's other fields are kept for the PUT back. */
export const parseGroups = (json: unknown): TakGroup[] => {
  const data = (json as { data?: unknown })?.data;
  return Array.isArray(data) ? data.filter(isGroup) : [];
};

export const withActive = (groups: TakGroup[], target: TakGroup, active: boolean): TakGroup[] =>
  groups.map((group) =>
    group.name === target.name && group.direction === target.direction
      ? { ...group, active }
      : group,
  );

/** TAK applies the whole list to the connection that reports as `clientUid`. */
export const activeGroupsRequest = (groups: TakGroup[], clientUid: string): TakWrite => ({
  method: "PUT",
  path: `/Marti/api/groups/active?${new URLSearchParams({ clientUid })}`,
  body: groups,
});

export const fetchGroups = async (signal?: AbortSignal): Promise<TakGroup[]> => {
  const text = await takGetText("/Marti/api/groups/all?useCache=true", signal);
  return text ? parseGroups(JSON.parse(text)) : [];
};

export const setActiveGroups = (groups: TakGroup[], clientUid: string) =>
  takSend(activeGroupsRequest(groups, clientUid));
