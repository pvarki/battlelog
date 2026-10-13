import { expect, test } from "vitest";
import type { Mission } from "./missions.ts";
import {
  addContentsRequest,
  canDelete,
  createMissionRequest,
  deleteMissionRequest,
  logEntryRequest,
  parseToken,
  removeContentRequest,
  subscriptionPath,
} from "./writes.ts";

// Shapes verified against the dev TAK (5.8).
const me = "BattleLog-Eversti";

test("create and delete name the client uid as creator", () => {
  expect(createMissionRequest("Oulu tuho", "Kohteet", me)).toEqual({
    method: "PUT",
    path: "/Marti/api/missions/Oulu%20tuho?creatorUid=BattleLog-Eversti&description=Kohteet&tool=public",
  });
  expect(deleteMissionRequest("a/b", me)).toEqual({
    method: "DELETE",
    path: "/Marti/api/missions/a%2Fb?creatorUid=BattleLog-Eversti",
  });
});

test("subscriptions are per client uid", () => {
  expect(subscriptionPath("RECON", me)).toBe(
    "/Marti/api/missions/RECON/subscription?uid=BattleLog-Eversti",
  );
});

test("items and files are added in the body and removed by query", () => {
  expect(addContentsRequest("RECON", { uids: ["u1"] }, me)).toEqual({
    method: "PUT",
    path: "/Marti/api/missions/RECON/contents?creatorUid=BattleLog-Eversti",
    body: { uids: ["u1"] },
  });
  expect(removeContentRequest("RECON", { hash: "ab12" }, me).path).toBe(
    "/Marti/api/missions/RECON/contents?hash=ab12&creatorUid=BattleLog-Eversti",
  );
  expect(removeContentRequest("RECON", { uid: "u 1" }, me).path).toBe(
    "/Marti/api/missions/RECON/contents?uid=u+1&creatorUid=BattleLog-Eversti",
  );
});

test("log entries name their mission in the body", () => {
  expect(logEntryRequest("RECON", "Kontakti", me, Date.parse("2026-10-13T19:05:00Z"))).toEqual({
    method: "POST",
    path: "/Marti/api/missions/logs/entries",
    body: {
      dtg: "2026-10-13T19:05:00.000Z",
      content: "Kontakti",
      creatorUid: me,
      missionNames: ["RECON"],
    },
  });
});

test("the token comes from a subscription or the created mission", () => {
  expect(parseToken({ data: { token: "t1", clientUid: me } })).toBe("t1");
  expect(parseToken({ data: [{ name: "BL", token: "t2" }] })).toBe("t2");
  expect(parseToken({ data: [{ name: "BL" }] })).toBeUndefined();
  expect(parseToken({ status: "NOT_FOUND" })).toBeUndefined();
  expect(parseToken(null)).toBeUndefined();
});

test("only the creator may delete", () => {
  const mission = { creatorUid: me } as Mission;
  expect(canDelete(mission, me)).toBe(true);
  expect(canDelete(mission, "ANDROID-1")).toBe(false);
  expect(canDelete({} as Mission, undefined)).toBe(false);
});
