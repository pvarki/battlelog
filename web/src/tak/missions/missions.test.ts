// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import {
  exportPath,
  fetchMissionItems,
  parseInvitations,
  parseInvitedMissions,
  parseMembers,
  parseMissionLayers,
  parseMissionList,
} from "./missions.ts";

// Shaped like the dev TAK's GET /Marti/api/missions.
const list = {
  version: "3",
  type: "Mission",
  data: [
    {
      name: "RECON",
      description: "Recon feed for validated information",
      creatorUid: "",
      createTime: "2026-09-16T15:45:33.021Z",
      keywords: ["#RECON"],
      passwordProtected: false,
      inviteOnly: false,
      defaultRole: { type: "MISSION_SUBSCRIBER", permissions: ["MISSION_READ", "MISSION_WRITE"] },
      uids: [
        { data: "lipas-1", timestamp: "2026-10-10T22:50:31.751Z", creatorUid: "ANDROID-1" },
        { data: "lipas-2", timestamp: "2026-10-09T10:00:00.000Z", creatorUid: "ANDROID-1" },
      ],
      contents: [
        {
          timestamp: "2026-09-16T18:17:30.426Z",
          data: {
            uid: "f2d5",
            name: "pvarki-terrain-high.json",
            hash: "3bbb",
            size: 761,
            submitter: "Eetu",
            mimeType: "application/octet-stream",
          },
        },
      ],
    },
    {
      name: "Locked",
      passwordProtected: true,
      inviteOnly: true,
      createTime: "2026-10-01T00:00:00Z",
    },
    { description: "no name, skipped" },
  ],
};

test("missions with their items, files and newest change", () => {
  const [recon, locked] = parseMissionList(list);
  expect(recon).toMatchObject({
    name: "RECON",
    description: "Recon feed for validated information",
    creatorUid: undefined,
    keywords: ["#RECON"],
    passwordProtected: false,
    inviteOnly: false,
    defaultRole: "MISSION_SUBSCRIBER",
    itemUids: ["lipas-1", "lipas-2"],
    files: [{ name: "pvarki-terrain-high.json", hash: "3bbb", size: 761, submitter: "Eetu" }],
    changedAt: Date.parse("2026-10-10T22:50:31.751Z"),
  });
  expect(locked).toMatchObject({
    passwordProtected: true,
    inviteOnly: true,
    defaultRole: undefined,
    itemUids: [],
    files: [],
  });
});

test("entries without a name and malformed responses are skipped", () => {
  expect(parseMissionList(list)).toHaveLength(2);
  expect(parseMissionList({})).toEqual([]);
  expect(parseMissionList(null)).toEqual([]);
});

test("removing an older item still changes the version, so contents are refetched", () => {
  const [before] = parseMissionList(list);
  const mission = list.data[0] as { uids: unknown[] };
  const [after] = parseMissionList({
    data: [{ ...list.data[0], uids: mission.uids.slice(0, 1) }],
  });
  expect(after?.changedAt).toBe(before?.changedAt);
  expect(after?.version).not.toBe(before?.version);
});

test("a mission's map layers; malformed ones leave none", () => {
  const [recon] = parseMissionList({
    data: [
      {
        ...list.data[0],
        mapLayers: [{ uid: "l1", name: "Ortho", type: "WMS", url: "https://maps/wms" }],
      },
    ],
  });
  expect(recon?.mapLayers).toEqual([{ name: "Ortho", type: "WMS", url: "https://maps/wms" }]);
  expect(parseMissionList(list)[0]?.mapLayers).toEqual([]);
});

test("the layer tree flattens with each child after its parent", () => {
  expect(
    parseMissionLayers({
      data: [
        {
          uid: "g1",
          name: "Group",
          type: "GROUP",
          children: [{ uid: "i1", type: "ITEM", parentUid: "g1" }],
        },
        { name: "no uid, skipped" },
        { uid: "m1", name: "Basemap", type: "MAPLAYER" },
      ],
    }),
  ).toEqual([
    { uid: "g1", name: "Group", type: "GROUP", depth: 0 },
    { uid: "i1", name: "i1", type: "ITEM", depth: 1 },
    { uid: "m1", name: "Basemap", type: "MAPLAYER", depth: 0 },
  ]);
  expect(parseMissionLayers({})).toEqual([]);
});

test("exports are KML for download or TAK's archive", () => {
  expect(exportPath("a b", "kml")).toBe("/Marti/api/missions/a%20b/kml?download=true");
  expect(exportPath("a b", "archive")).toBe("/Marti/api/missions/a%20b/archive");
});

test("members with their roles; an unknown role reads as none", () => {
  expect(
    parseMembers({
      data: [
        { clientUid: "ANDROID-1", username: "eetu", role: { type: "MISSION_OWNER" } },
        { clientUid: "BattleLog-Eversti", role: { type: "MISSION_READONLY_SUBSCRIBER" } },
        { clientUid: "ANDROID-2", role: { type: "SOMETHING_NEW" } },
        { username: "no uid, skipped" },
      ],
    }),
  ).toEqual([
    { clientUid: "ANDROID-1", username: "eetu", role: "MISSION_OWNER" },
    { clientUid: "BattleLog-Eversti", username: undefined, role: "MISSION_READONLY_SUBSCRIBER" },
    { clientUid: "ANDROID-2", username: undefined, role: undefined },
  ]);
  expect(parseMembers({})).toEqual([]);
});

test("a mission's invitations, without their tokens", () => {
  expect(
    parseInvitations({
      data: [
        {
          missionName: "BL",
          invitee: "Eetu",
          type: "callsign",
          token: "secret",
          role: { type: "MISSION_SUBSCRIBER" },
        },
        { invitee: "x", type: "team" },
      ],
    }),
  ).toEqual([{ type: "callsign", invitee: "Eetu", role: "MISSION_SUBSCRIBER" }]);
});

test("invitations for me name their missions once", () => {
  expect(parseInvitedMissions({ data: ["BL", "RECON", "BL"] })).toEqual(["BL", "RECON"]);
  expect(parseInvitedMissions({ data: [{ missionName: "BL" }, {}] })).toEqual(["BL"]);
  expect(parseInvitedMissions(null)).toEqual([]);
});

test("a mission of over 20,000 items is refused", async () => {
  const event = (i: number) =>
    `<event version="2.0" uid="u${i}" type="a-f-G" how="h-e" time="2026-10-13T10:00:00Z" start="2026-10-13T10:00:00Z" stale="2026-10-14T10:00:00Z"><point lat="60" lon="25" hae="0" ce="0" le="0"/><detail/></event>`;
  const xml = `<events>${Array.from({ length: 20_001 }, (_, i) => event(i)).join("")}</events>`;
  vi.stubGlobal("fetch", async () => new Response(xml));
  await expect(fetchMissionItems("BIG")).rejects.toThrow(/20,000/);
  vi.unstubAllGlobals();
}, 30_000);
