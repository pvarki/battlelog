import { type CotEvent, type TakItem, toChange } from "./cot.ts";
import type { MissionsState } from "./missions/store.ts";
import type { Plan } from "./plans/plans.ts";
import { takStore } from "./session.ts";

/**
 * The live picture plus the items of missions shown on the map. A mission
 * item that is also live is the same uid; the live copy wins. A mission's copy
 * of an item deleted since stays off the map: its list may not have caught up.
 */
const withMissionItems = (
  live: TakItem[],
  missions: MissionsState,
  shown: ReadonlySet<string>,
  deletedAt: (uid: string) => number | undefined,
) => {
  const seen = new Set(live.map((i) => i.uid));
  const extra: TakItem[] = [];
  for (const [name, contents] of missions.contents) {
    if (!shown.has(name) || contents.kind !== "loaded") continue;
    for (const item of contents.items) {
      if (!seen.has(item.uid) && (deletedAt(item.uid) ?? -1) < item.time) {
        seen.add(item.uid);
        extra.push(item);
      }
    }
  }
  return extra.length ? [...live, ...extra] : live;
};

type Draft = { item: TakItem; conflict: boolean; deleted: boolean };

/**
 * A plan's drafts as map items, named so they can't be mistaken for what TAK
 * has. A staged delete shows the item it removes, or what the delete names.
 */
// One item per stored draft, so re-rendering doesn't hand the map "new" items that changed nothing.
const draftItemCache = new WeakMap<CotEvent, TakItem>();
const draftItemOf = (event: CotEvent, item: TakItem) => {
  let cached = draftItemCache.get(event);
  if (!cached) {
    cached = { ...item, draft: true };
    draftItemCache.set(event, cached);
  }
  return cached;
};

// A draft's event never changes once stored; parsing its XML on every render cost a third of the main thread.
const draftChangeCache = new WeakMap<CotEvent, ReturnType<typeof toChange>>();
const draftChangeOf = (event: CotEvent) => {
  if (!draftChangeCache.has(event)) draftChangeCache.set(event, toChange(event));
  return draftChangeCache.get(event) ?? null;
};

export const draftItems = (plan: Plan, live: TakItem[]): Draft[] => {
  const liveByUid = new Map(live.map((i) => [i.uid, i]));
  return plan.entries.flatMap(({ event, basedOn }): Draft[] => {
    const change = draftChangeOf(event);
    if (!change || change.kind === "offline") return [];
    const current = liveByUid.get(event.uid);
    const conflict = basedOn !== undefined && !!current && current.time > basedOn;
    if (change.kind === "upsert")
      return [{ item: draftItemOf(event, change.item), conflict, deleted: false }];
    const item: TakItem = current ?? {
      uid: event.uid,
      type: event.type,
      time: event.time,
      stale: event.stale,
      geometry: { type: "Point", coordinates: [0, 0] },
      event,
    };
    return [{ item: { ...item, draft: true }, conflict, deleted: true }];
  });
};

/** Live items with the active plan's drafts in place of (or beside) them; staged deletes hide theirs. */
const withDrafts = (items: TakItem[], drafts: Draft[]) => {
  if (drafts.length === 0) return items;
  const drafted = new Set(drafts.map((d) => d.item.uid));
  return [
    ...items.filter((i) => !drafted.has(i.uid)),
    ...drafts.flatMap((d) => (d.deleted ? [] : [d.item])),
  ];
};

/** What the workspace shows: the replayed moment, or live items with missions and the active plan's drafts. */
export const workspacePicture = ({
  replaying,
  replayItems,
  selfUid,
  liveItems,
  missions,
  shownMissions,
  activePlan,
}: {
  replaying: boolean;
  replayItems: TakItem[] | undefined;
  selfUid: string;
  liveItems: TakItem[];
  missions: MissionsState;
  shownMissions: ReadonlySet<string>;
  activePlan: Plan | undefined;
}) => {
  // The rest of the workspace (contacts, chat, emergencies) stays live while replaying.
  const items = replaying
    ? (replayItems ?? []).filter((i) => i.uid !== selfUid)
    : withDrafts(
        withMissionItems(liveItems, missions, shownMissions, takStore.deletedAt),
        activePlan ? draftItems(activePlan, liveItems) : [],
      );
  const missionItem = (uid: string) => {
    for (const contents of missions.contents.values()) {
      const found = contents.kind === "loaded" && contents.items.find((i) => i.uid === uid);
      if (found && (takStore.deletedAt(uid) ?? -1) < found.time) return found;
    }
  };
  const currentItem = (uid: string) => items.find((i) => i.uid === uid) ?? missionItem(uid);
  return { items, missionItem, currentItem };
};
