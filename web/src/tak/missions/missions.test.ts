import { expect, test } from "vitest";
import { parseMissionList } from "./missions.ts";

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
    { name: "Locked", passwordProtected: true, createTime: "2026-10-01T00:00:00Z" },
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
    restricted: false,
    itemUids: ["lipas-1", "lipas-2"],
    files: [{ name: "pvarki-terrain-high.json", hash: "3bbb", size: 761, submitter: "Eetu" }],
    changedAt: Date.parse("2026-10-10T22:50:31.751Z"),
  });
  expect(locked).toMatchObject({ restricted: true, itemUids: [], files: [] });
});

test("entries without a name and malformed responses are skipped", () => {
  expect(parseMissionList(list)).toHaveLength(2);
  expect(parseMissionList({})).toEqual([]);
  expect(parseMissionList(null)).toEqual([]);
});
