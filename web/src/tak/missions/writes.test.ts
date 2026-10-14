import { expect, test } from "vitest";
import type { Mission } from "./missions.ts";
import {
  addContentsRequest,
  canDelete,
  canWriteAs,
  createMissionRequest,
  deleteMissionRequest,
  inviteRequest,
  logEntryRequest,
  type NewMission,
  parseSubscription,
  removeContentRequest,
  removePasswordRequest,
  setPasswordRequest,
  setRoleRequest,
  subscribeDeniedMessage,
  subscriptionPath,
  uninviteRequest,
} from "./writes.ts";

// Shapes verified against the dev TAK (5.8).
const me = "BattleLog-Eversti";

test("create and delete name the client uid as creator", () => {
  expect(createMissionRequest("Oulu tuho", { description: "Kohteet" }, me)).toEqual({
    method: "PUT",
    path: "/Marti/api/missions/Oulu%20tuho?creatorUid=BattleLog-Eversti&description=Kohteet&tool=public",
  });
  expect(deleteMissionRequest("a/b", me)).toEqual({
    method: "DELETE",
    path: "/Marti/api/missions/a%2Fb?creatorUid=BattleLog-Eversti",
  });
});

test("a new mission may have a default role, a password and be invite-only", () => {
  const settings: NewMission = {
    defaultRole: "MISSION_READONLY_SUBSCRIBER",
    password: "s&1", // pragma: allowlist secret
    inviteOnly: true,
  };
  expect(createMissionRequest("BL", settings, me).path).toBe(
    "/Marti/api/missions/BL?creatorUid=BattleLog-Eversti&description=&tool=public&password=s%261&defaultRole=MISSION_READONLY_SUBSCRIBER&inviteOnly=true",
  );
  expect(createMissionRequest("BL", { password: "", inviteOnly: false }, me).path).toBe(
    "/Marti/api/missions/BL?creatorUid=BattleLog-Eversti&description=&tool=public",
  );
});

test("subscriptions are per client uid, with the password when there is one", () => {
  expect(subscriptionPath("RECON", me)).toBe(
    "/Marti/api/missions/RECON/subscription?uid=BattleLog-Eversti",
  );
  expect(subscriptionPath("RECON", me, "p w")).toBe(
    "/Marti/api/missions/RECON/subscription?uid=BattleLog-Eversti&password=p+w",
  );
});

test("owners set roles, invitations and the password", () => {
  expect(setRoleRequest("RECON", "ANDROID-1", "MISSION_READONLY_SUBSCRIBER")).toEqual({
    method: "PUT",
    path: "/Marti/api/missions/RECON/role?clientUid=ANDROID-1&role=MISSION_READONLY_SUBSCRIBER",
  });
  expect(inviteRequest("RECON", "callsign", "Eetu/2", "MISSION_SUBSCRIBER", me)).toEqual({
    method: "PUT",
    path: "/Marti/api/missions/RECON/invite/callsign/Eetu%2F2?creatorUid=BattleLog-Eversti&role=MISSION_SUBSCRIBER",
  });
  expect(uninviteRequest("RECON", "group", "__ANON__", me)).toEqual({
    method: "DELETE",
    path: "/Marti/api/missions/RECON/invite/group/__ANON__?creatorUid=BattleLog-Eversti",
  });
  expect(setPasswordRequest("RECON", "salainen", me)).toEqual({
    method: "PUT",
    path: "/Marti/api/missions/RECON/password?password=salainen&creatorUid=BattleLog-Eversti",
  });
  expect(removePasswordRequest("RECON", me)).toEqual({
    method: "DELETE",
    path: "/Marti/api/missions/RECON/password?creatorUid=BattleLog-Eversti",
  });
});

test("items and files are added in the body and removed by query", () => {
  expect(addContentsRequest("RECON", { uids: ["u1"] }, me)).toEqual({
    method: "PUT",
    path: "/Marti/api/missions/RECON/contents?creatorUid=BattleLog-Eversti",
    body: { uids: ["u1"] },
  });
  expect(addContentsRequest("RECON", { uids: ["u1", "u2"] }, me).body).toEqual({
    uids: ["u1", "u2"],
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

test("the token and role come from a subscription or the created mission", () => {
  expect(
    parseSubscription({
      data: { token: "t1", clientUid: me, role: { type: "MISSION_OWNER", permissions: [] } },
    }),
  ).toEqual({ token: "t1", role: "MISSION_OWNER" });
  expect(parseSubscription({ data: [{ name: "BL", token: "t2" }] })).toEqual({ token: "t2" });
  expect(parseSubscription({ data: { token: "t3", role: { type: "ADMIN" } } })).toEqual({
    token: "t3",
  });
  expect(parseSubscription({ data: [{ name: "BL" }] })).toBeUndefined();
  expect(parseSubscription({ status: "NOT_FOUND" })).toBeUndefined();
  expect(parseSubscription(null)).toBeUndefined();
});

test("the creator and owners may delete", () => {
  const mission = { creatorUid: me } as Mission;
  expect(canDelete(mission, me, undefined)).toBe(true);
  expect(canDelete(mission, "ANDROID-1", "MISSION_SUBSCRIBER")).toBe(false);
  expect(canDelete(mission, "ANDROID-1", "MISSION_OWNER")).toBe(true);
  expect(canDelete({} as Mission, undefined, "MISSION_OWNER")).toBe(false);
});

test("read-only subscribers can't write", () => {
  expect(canWriteAs("MISSION_READONLY_SUBSCRIBER")).toBe(false);
  expect(canWriteAs("MISSION_SUBSCRIBER")).toBe(true);
  expect(canWriteAs(undefined)).toBe(true);
});

test("a refused subscribe says what's missing", () => {
  const locked = { passwordProtected: true } as Mission;
  expect(subscribeDeniedMessage(locked, true)).toBe("TAK refused the password.");
  expect(subscribeDeniedMessage(locked, false)).toBe("The feed needs a password.");
  expect(subscribeDeniedMessage(undefined, false)).toMatch(/invite-only/);
});
